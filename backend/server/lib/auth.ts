/**
 * 认证层：密码哈希（scrypt）、会话 Cookie、requireAuth 中间件、限速器。
 * 不引入任何第三方库。
 */

import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import {
  findUserById,
  findUserByEmail,
  findUserByUsername,
  insertSession,
  insertUser,
  deleteSession,
  findSession,
  sweepExpiredSessions,
} from './db';

export const SESSION_COOKIE = 'ielts_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
const COOKIE_MAX_AGE = SESSION_TTL_MS;

export const PUBLIC_SIGNUP = process.env.PUBLIC_SIGNUP !== 'false';
export const USER_DATA_MAX_MB = Number(process.env.USER_DATA_MAX_MB || 25);
export const AI_RATE_PER_MIN = Number(process.env.AI_RATE_PER_MIN || 120);

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------------- 密码哈希 ----------------

export function hashPassword(password: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

// ---------------- 会话 / Cookie ----------------

function isSecureCookies(): boolean {
  if (process.env.COOKIE_SECURE !== undefined) return process.env.COOKIE_SECURE === 'true';
  return process.env.NODE_ENV === 'production';
}

export function cookieDomain(): string | undefined {
  // 默认同域；如部署在子域可配 COOKIE_DOMAIN。
  return process.env.COOKIE_DOMAIN || undefined;
}

export function startSession(userId: number, res: Response): void {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  insertSession(userId, token, expiresAt);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: process.env.COOKIE_SAME_SITE === 'none' ? 'none' : 'lax',
    secure: isSecureCookies(),
    domain: cookieDomain(),
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: process.env.COOKIE_SAME_SITE === 'none' ? 'none' : 'lax',
    secure: isSecureCookies(),
    domain: cookieDomain(),
    path: '/',
  });
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/** 从请求 Cookie 解析出已登录 userId（会校验会话有效期）；未登录返回 undefined。 */
export function authedUserId(req: Request): number | undefined {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return undefined;
  sweepExpiredSessions();
  const session = findSession(token);
  if (!session) return undefined;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    deleteSession(token);
    return undefined;
  }
  return session.user_id;
}

/** Express 中间件：未登录 → 401。成功后把 userId 挂到 req（any 便于 Express 4 类型）。 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    const uid = authedUserId(req);
    if (!uid) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    (req as any).userId = uid;
    next();
  } catch (e) {
    next(e);
  }
}

// ---------------- 注册 / 登录逻辑 ----------------

export function publicUserShape(uid: number) {
  const user = findUserById(uid);
  if (!user) throw new HttpError(401, '用户不存在');
  let llmConfigured = false;
  let llmProvider: string | null = null;
  let llmModel: string | null = null;
  if (user.llm_json) {
    try {
      const parsed = JSON.parse(user.llm_json);
      llmConfigured = true;
      llmProvider = parsed.provider || null;
      llmModel = parsed.model || null;
    } catch {
      /* ignore */
    }
  }
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.created_at,
    llmConfigured,
    llmProvider,
    llmModel,
    isAdmin: isAdminUser(uid),
  };
}

/** Admin access is granted only to the configured account username. */
export function isAdminUser(uid: number): boolean {
  const configuredUsername = (process.env.ADMIN_USERNAME || '').trim().toLocaleLowerCase();
  const user = configuredUsername ? findUserById(uid) : undefined;
  return !!user && user.username.toLocaleLowerCase() === configuredUsername;
}

export function registerUser(opts: {
  username: string;
  email?: string | null;
  password: string;
}): number {
  const username = (opts.username || '').trim();
  const email = opts.email ? (opts.email as string).trim().toLowerCase() : null;
  const password = opts.password || '';

  if (!PUBLIC_SIGNUP) throw new HttpError(403, '当前未开放注册');
  if (username.length < 2 || username.length > 30) {
    throw new HttpError(400, '用户名长度需在 2–30 个字符之间');
  }
  if (!/^[a-zA-Z0-9_\-一-龥]+$/.test(username)) {
    throw new HttpError(400, '用户名仅可含中英文、数字、下划线与连字符');
  }
  if (password.length < 6) {
    throw new HttpError(400, '密码至少 6 位');
  }
  if (findUserByUsername(username)) throw new HttpError(409, '该用户名已被注册');
  if (email && findUserByEmail(email)) throw new HttpError(409, '该邮箱已被注册');

  const { salt, hash } = hashPassword(password);
  return insertUser({ username, email, passSalt: salt, passHash: hash });
}

export function loginByIdentifier(identifier: string, password: string): number {
  const idf = (identifier || '').trim();
  if (!idf || !password) throw new HttpError(400, '请输入账号与密码');
  const user =
    findUserByUsername(idf) || (idf.includes('@') ? findUserByEmail(idf.toLowerCase()) : undefined);
  if (!user || !verifyPassword(password, user.pass_salt, user.pass_hash)) {
    throw new HttpError(401, '账号或密码错误');
  }
  return user.id;
}

export function logoutByRequest(req: Request): void {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (token) deleteSession(token);
}

// ---------------- 简易内存限速 ----------------

interface Bucket {
  count: number;
  resetAt: number;
}

/** 内存令牌式限速器。key 由调用方决定（IP / userId / 混合）。 */
export function makeRateLimiter(opts: { windowMs: number; max: number }) {
  const buckets = new Map<string, Bucket>();
  // 定期清理，防无限增长
  const cleaner = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (b.resetAt < now) buckets.delete(k);
    }
  }, opts.windowMs);
  if (typeof cleaner.unref === 'function') cleaner.unref();

  return {
    check(key: string): { ok: boolean; retryAfterMs: number } {
      const now = Date.now();
      let b = buckets.get(key);
      if (!b || b.resetAt < now) {
        b = { count: 0, resetAt: now + opts.windowMs };
        buckets.set(key, b);
      }
      if (b.count >= opts.max) {
        return { ok: false, retryAfterMs: b.resetAt - now };
      }
      b.count += 1;
      return { ok: true, retryAfterMs: 0 };
    },
  };
}

export const authRateLimiter = makeRateLimiter({ windowMs: 60_000, max: 30 });
export const appRateLimiter = makeRateLimiter({ windowMs: 60_000, max: Math.max(30, AI_RATE_PER_MIN) });

export function clientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || 'unknown';
}
