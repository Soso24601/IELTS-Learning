/**
 * 用户系统路由：挂载全局鉴权门卫 + /api/auth/* + /api/data/* + /api/me/*。
 * server.ts 只调用 installUserSystem(app)。
 */

import type { Application, Request, Response, Router } from 'express';
import { Router as createRouter } from 'express';
import {
  HttpError,
  USER_DATA_MAX_MB,
  appRateLimiter,
  authRateLimiter,
  authedUserId,
  clearSession,
  clientIp,
  loginByIdentifier,
  logoutByRequest,
  publicUserShape,
  registerUser,
  requireAuth,
  startSession,
} from './auth';
import {
  deleteAllUserState,
  findUserById,
  getStateSnapshot,
  getStateTotalChars,
  getStateValue,
  importState,
  upsertState,
} from './db';
import { LLMConfig, parseLLMConfig, saveUserLLMConfig, testLLMConfig } from './llm';
import { assertSafeHttpUrlSync } from './net';

const IS_JSON_KEY = /^ielts_[A-Za-z0-9_]+$/;

function sendError(res: Response, e: any, fallback: string) {
  const status = e instanceof HttpError ? e.status : e?.status || 500;
  res.status(status).json({ error: e?.message || fallback });
}

export function installUserSystem(app: Application): void {
  app.set('trust proxy', 1);

  // ---- 全局 /api 门卫：/api/auth 与 /api/health 放行，其余必须登录 + 按用户限速 ----
  app.use('/api', (req, res, next) => {
    const full = (req.originalUrl || '').split('?')[0];
    if (full === '/api/health' || full.startsWith('/api/auth')) {
      return next();
    }
    const uid = authedUserId(req);
    if (!uid) {
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    const limit = appRateLimiter.check(`u${uid}`);
    if (!limit.ok) {
      res.setHeader('Retry-After', String(Math.ceil(limit.retryAfterMs / 1000)));
      res.status(429).json({ error: '请求过于频繁，请稍后再试' });
      return;
    }
    (req as any).userId = uid;
    next();
  });

  app.use('/api/auth', buildAuthRouter());
  app.use('/api/data', buildDataRouter());
  app.use('/api/me', buildMeRouter());
}

// ---------------- /api/auth/* ----------------

function buildAuthRouter(): Router {
  const r = createRouter();

  r.post('/register', (req: Request, res: Response) => {
    try {
      const ipLim = authRateLimiter.check(`reg:${clientIp(req)}`);
      if (!ipLim.ok) return res.status(429).json({ error: '注册尝试过于频繁，请稍后再试' });
      const { username, email, password } = req.body || {};
      const uid = registerUser({ username, email, password });
      startSession(uid, res);
      res.status(201).json({ user: publicUserShape(uid) });
    } catch (e) {
      sendError(res, e, '注册失败');
    }
  });

  r.post('/login', (req: Request, res: Response) => {
    try {
      const ipLim = authRateLimiter.check(`login:${clientIp(req)}`);
      if (!ipLim.ok) return res.status(429).json({ error: '登录尝试过于频繁，请稍后再试' });
      const { identifier, password } = req.body || {};
      const uid = loginByIdentifier(identifier, password);
      startSession(uid, res);
      res.json({ user: publicUserShape(uid) });
    } catch (e) {
      sendError(res, e, '登录失败');
    }
  });

  r.post('/logout', (req: Request, res: Response) => {
    logoutByRequest(req);
    clearSession(res);
    res.json({ ok: true });
  });

  r.get('/me', requireAuth, (req: Request, res: Response) => {
    res.json({ user: publicUserShape((req as any).userId) });
  });

  return r;
}

// ---------------- /api/data/* ----------------

function buildDataRouter(): Router {
  const r = createRouter();

  // 全量快照（登录后/每次回填用）
  r.get('/snapshot', (req: Request, res: Response) => {
    try {
      const uid = (req as any).userId as number;
      const data = getStateSnapshot(uid);
      res.json({ data, count: Object.keys(data).length });
    } catch (e) {
      sendError(res, e, '读取数据失败');
    }
  });

  // 单 key 增量写入
  r.post('/key', (req: Request, res: Response) => {
    try {
      const uid = (req as any).userId as number;
      const key = String((req.body || {}).key || '');
      const value = typeof req.body?.value === 'string' ? req.body.value : '';
      if (!IS_JSON_KEY.test(key)) return res.status(400).json({ error: '非法的数据键名' });
      if (value.length > 100_000_000) return res.status(413).json({ error: '单条数据过大' });

      const cap = USER_DATA_MAX_MB * 1024 * 1024;
      const cur = getStateValue(uid, key)?.length || 0;
      const total = getStateTotalChars(uid) - cur + value.length;
      if (total > cap) {
        return res.status(413).json({
          error: `账号数据已达 ${USER_DATA_MAX_MB}MB 上限，请删除部分材料后再试`,
        });
      }
      upsertState(uid, key, value);
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e, '保存失败');
    }
  });

  // 批量导入（合并本地旧数据 / 备份恢复）
  r.post('/import', (req: Request, res: Response) => {
    try {
      const uid = (req as any).userId as number;
      const data = (req.body || {}).data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return res.status(400).json({ error: '缺少待导入数据' });
      }
      const entries: [string, string][] = [];
      const cap = USER_DATA_MAX_MB * 1024 * 1024;
      for (const [k, v] of Object.entries(data)) {
        if (!IS_JSON_KEY.test(k)) continue;
        const s = typeof v === 'string' ? v : JSON.stringify(v);
        if (!s) continue;
        entries.push([k, s]);
      }
      if (entries.length === 0) return res.status(400).json({ error: '没有可导入的 ielts_ 数据' });
      const total = getStateTotalChars(uid) + entries.reduce((a, [, v]) => a + v.length, 0);
      if (total > cap) return res.status(413).json({ error: `导入后超出 ${USER_DATA_MAX_MB}MB 上限` });
      importState(uid, entries);
      res.json({ ok: true, imported: entries.length });
    } catch (e) {
      sendError(res, e, '导入失败');
    }
  });

  // 危险操作：清空本账号云端数据（重置用）
  r.delete('/all', (req: Request, res: Response) => {
    try {
      const uid = (req as any).userId as number;
      deleteAllUserState(uid);
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e, '清空失败');
    }
  });

  return r;
}

// ---------------- /api/me/* ----------------

function buildMeRouter(): Router {
  const r = createRouter();

  function readUserId(req: Request): number {
    return (req as any).userId as number;
  }

  function mergeConfigFromBody(body: any, existing: LLMConfig | null): LLMConfig {
    const provider = body?.provider === 'gemini' ? 'gemini' : body?.provider === 'openai' ? 'openai' : 'deepseek';
    let apiKey = String(body?.apiKey || '').trim();
    if (!apiKey && existing && existing.provider === provider) apiKey = existing.apiKey; // 未改则沿用旧 Key
    if (!apiKey) throw new HttpError(400, '请填写 API Key');

    if (provider === 'gemini') {
      const model = String(body?.model || '').trim() || existing?.model || 'gemini-3.6-flash';
      return { provider, apiKey, baseUrl: '', model };
    }
    // openai 兼容（deepseek 预设 / 自定义）
    let baseUrl = String(body?.baseUrl || '').trim();
    if (provider === 'deepseek' && !baseUrl) baseUrl = 'https://api.deepseek.com/v1';
    if (!/^https?:\/\//.test(baseUrl)) throw new HttpError(400, 'Base URL 需以 http(s):// 开头');
    try {
      assertSafeHttpUrlSync(baseUrl);
    } catch (e: any) {
      throw new HttpError(400, e?.message || 'Base URL 不合法');
    }
    const model = String(body?.model || '').trim();
    if (!model) throw new HttpError(400, '请填写模型名（如 deepseek-chat）');
    return { provider, apiKey, baseUrl, model };
  }

  // 当前 LLM 配置概要（不含 Key）
  r.get('/llm', (req: Request, res: Response) => {
    try {
      const existing = parseLLMConfigByUserId(readUserId(req));
      res.json({
        configured: !!existing,
        provider: existing?.provider || null,
        model: existing?.model || null,
        baseUrl: existing?.baseUrl || null,
      });
    } catch (e) {
      sendError(res, e, '读取失败');
    }
  });

  // 保存 LLM 配置（Key 加密落库）
  r.post('/llm', (req: Request, res: Response) => {
    try {
      const uid = readUserId(req);
      const existing = parseLLMConfigByUserId(uid);
      const cfg = mergeConfigFromBody(req.body || {}, existing);
      saveUserLLMConfig(uid, cfg);
      res.json({ ok: true, user: publicUserShape(uid) });
    } catch (e) {
      sendError(res, e, '保存失败');
    }
  });

  // 测试连接（用请求体配置，未保存）
  r.post('/llm/test', async (req: Request, res: Response) => {
    try {
      const uid = readUserId(req);
      const existing = parseLLMConfigByUserId(uid);
      const cfg = mergeConfigFromBody(req.body || {}, existing);
      const reply = await testLLMConfig(cfg);
      res.json({ ok: true, reply });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || '连接失败' });
    }
  });

  return r;
}

function parseLLMConfigByUserId(uid: number): LLMConfig | null {
  const user = findUserById(uid);
  return user ? parseLLMConfig(user.llm_json) : null;
}
