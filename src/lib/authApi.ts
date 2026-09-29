/**
 * 前端 API 封装：所有调用同源相对路径，登录态经 httpOnly Cookie 自动携带。
 */

export interface PublicUser {
  id: number;
  username: string;
  email: string | null;
  createdAt: string;
  llmConfigured: boolean;
  llmProvider: string | null;
  llmModel: string | null;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = '') {
    super(message);
    this.status = status;
    this.code = code || message || '';
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* ignore non-json */
  }
  if (!res.ok) {
    const msg = typeof data?.error === 'string' ? data.error : `请求失败 (${res.status})`;
    throw new ApiError(res.status, msg, data?.error || msg);
  }
  return data as T;
}

const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export function apiMe(): Promise<{ user: PublicUser }> {
  return req('/api/auth/me');
}
export function apiLogin(identifier: string, password: string): Promise<{ user: PublicUser }> {
  return req('/api/auth/login', json({ identifier, password }));
}
export function apiRegister(username: string, email: string, password: string): Promise<{ user: PublicUser }> {
  return req('/api/auth/register', json({ username, email, password }));
}
export function apiLogout(): Promise<{ ok: boolean }> {
  return req('/api/auth/logout', json({}));
}
export function apiSnapshot(): Promise<{ data: Record<string, string>; count: number }> {
  return req('/api/data/snapshot');
}
export function apiUploadKey(key: string, value: string, signal?: AbortSignal): Promise<{ ok: boolean }> {
  return req('/api/data/key', { ...json({ key, value }), signal });
}
export function apiImport(data: Record<string, string>): Promise<{ ok: boolean; imported: number }> {
  return req('/api/data/import', json({ data }));
}
export interface LLMSummary {
  configured: boolean;
  provider: string | null;
  model: string | null;
  baseUrl: string | null;
}
export function apiGetLLM(): Promise<LLMSummary> {
  return req('/api/me/llm');
}
export function apiSaveLLM(body: {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}): Promise<{ ok: boolean; user: PublicUser }> {
  return req('/api/me/llm', json(body));
}
export function apiTestLLM(body: {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}): Promise<{ ok: boolean; reply: string }> {
  return req('/api/me/llm/test', json(body));
}
export interface ASRSummary {
  configured: boolean;
  provider: 'aliyun' | null;
  region: 'beijing' | 'singapore';
}
export function apiGetASR(): Promise<ASRSummary> {
  return req('/api/me/asr');
}
export function apiSaveASR(body: { apiKey: string; region: 'beijing' | 'singapore' }): Promise<ASRSummary & { ok: boolean }> {
  return req('/api/me/asr', json(body));
}

/** 把后端错误信息转成对用户友好的中文提示。 */
export function friendlyApiError(err: any): string {
  const msg = err?.message || String(err);
  if (msg.includes('LLM_NOT_CONFIGURED')) return '尚未配置大模型 API Key：请到右上角「账号与设置」→「AI 大模型」填写你自己的 Key。';
  if (msg.includes('UNAUTHORIZED')) return '登录已过期，请重新登录。';
  if (err?.status === 429) return '操作太频繁，请稍后再试。';
  return msg;
}
