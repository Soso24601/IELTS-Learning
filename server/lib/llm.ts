/**
 * LLM 层（BYOK）：按登录用户自己的配置构造客户端。
 * - openai 兼容（DeepSeek / 自定义 baseUrl）：走 /chat/completions；
 * - gemini：走 @google/genai。
 * 用户在设置里保存的 API Key 会以 AES-256-GCM 加密后落库（密钥 = APP_SECRET）。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';
import { GoogleGenAI } from '@google/genai';
import { DATA_DIR, findUserById, setUserLLMJson } from './db';
import { HttpError } from './auth';
import { assertSafeHttpUrl, assertSafeHttpUrlSync } from './net';

export const KEY_FIELD = 'apiKeyEnc'; // llm_json 中 Key 的加密字段名

export interface LLMConfig {
  provider: 'deepseek' | 'openai' | 'gemini';
  apiKey: string;
  baseUrl: string; // openai 兼容用；gemini 忽略
  model: string; // openai 兼容模型名 / gemini 模型名
}

export type LLMStoreShape = {
  provider: LLMConfig['provider'];
  baseUrl: string;
  model: string;
  apiKeyEnc?: string;
};

/** LLM 客户端的最小接口（与现有路由代码兼容：models.generateContent / chats.create）。 */
export interface LLMClient {
  models: {
    generateContent: (params: any) => Promise<{ text: string }>;
  };
  chats: { create: (opts?: any) => any };
}

// ---------------- APP_SECRET & 加密 ----------------

function getMasterKey(): Buffer {
  const fromEnv = process.env.APP_SECRET;
  if (fromEnv && fromEnv !== 'MY_APP_SECRET') {
    return crypto.createHash('sha256').update(fromEnv).digest();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('APP_SECRET 未配置：生产环境必须提供 APP_SECRET（如用 `openssl rand -hex 32` 生成后写入 .env）');
  }
  // dev：在 DATA_DIR 下生成并持久化一个 .dev-secret，保证加密可用且重启一致
  const p = path.join(DATA_DIR, '.dev-secret');
  let secret: string;
  if (fs.existsSync(p)) {
    secret = fs.readFileSync(p, 'utf8').trim();
  } else {
    secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(p, secret, { mode: 0o600 });
  }
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(plain: string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptSecret(payload: string): string {
  const key = getMasterKey();
  const parts = payload.split(':');
  if (parts.length !== 3) throw new Error('存储的密钥密文格式损坏');
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}

/** 把待保存的配置序列化成落库的 llm_json（仅加密 API Key）。 */
export function serializeLLMConfig(cfg: LLMConfig): string {
  const store: LLMStoreShape = {
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
  };
  if (cfg.apiKey) store.apiKeyEnc = encryptSecret(cfg.apiKey);
  return JSON.stringify(store);
}

/** 从落库的 llm_json 还原出明文配置；为空 / 无法解析返回 null。 */
export function parseLLMConfig(llmJson: string): LLMConfig | null {
  if (!llmJson) return null;
  try {
    const store = JSON.parse(llmJson) as LLMStoreShape;
    if (!store.provider || (!store.apiKeyEnc && store.provider !== 'gemini')) return null;
    let apiKey = '';
    if (store.apiKeyEnc) apiKey = decryptSecret(store.apiKeyEnc);
    if (!apiKey) return null;
    return {
      provider: store.provider,
      apiKey,
      baseUrl: store.baseUrl || 'https://api.deepseek.com/v1',
      model: store.model || (store.provider === 'gemini' ? 'gemini-2.0-flash' : 'deepseek-chat'),
    };
  } catch {
    return null;
  }
}

// ---------------- OpenAI 兼容客户端（DeepSeek / 自定义） ----------------

function normalizeMessages(params: any): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];

  // systemInstruction
  if (params.config?.systemInstruction) {
    let sys = '';
    const si = params.config.systemInstruction;
    if (typeof si === 'string') sys = si;
    else if (typeof si === 'object') {
      if (Array.isArray(si.parts)) sys = si.parts.map((p: any) => p.text || '').join('\n');
      else if (si.text) sys = si.text;
    }
    if (sys) messages.push({ role: 'system', content: sys });
  }

  const push = (role: 'user' | 'assistant', text: string) => {
    if (text) messages.push({ role, content: text });
  };

  const contents = params.contents;
  if (typeof contents === 'string') {
    push('user', contents);
  } else if (Array.isArray(contents)) {
    for (const c of contents) {
      if (typeof c === 'string') {
        push('user', c);
      } else if (c && typeof c === 'object') {
        // 对话历史：{ role: user/model, parts:[{text}] }
        if (Array.isArray(c.parts)) {
          const role = c.role === 'model' || c.role === 'assistant' ? 'assistant' : 'user';
          const text = c.parts.map((p: any) => (typeof p === 'string' ? p : p?.text || '')).join('\n');
          push(role, text);
        } else if (typeof c.text === 'string') {
          push(c.role === 'model' || c.role === 'assistant' ? 'assistant' : 'user', c.text);
        }
      }
    }
  } else if (contents && typeof contents === 'object') {
    if (contents.text) push('user', contents.text);
    else if (Array.isArray(contents.parts)) {
      const text = contents.parts.map((p: any) => (typeof p === 'string' ? p : p?.text || '')).join('\n');
      push('user', text);
    }
  }
  return messages;
}

async function callOpenAICompatible(cfg: LLMConfig, params: any): Promise<{ text: string }> {
  const baseUrl = cfg.baseUrl.replace(/\/+$/, '');
  await assertSafeHttpUrl(cfg.baseUrl);

  const messages = normalizeMessages(params);
  if (messages.length === 0) throw new Error('没有可发送的内容');

  const isJSON = params.config?.responseMimeType === 'application/json';
  const body: any = {
    model: cfg.model,
    messages,
    temperature: params.config?.temperature !== undefined ? params.config.temperature : 0.7,
  };
  if (isJSON) {
    body.response_format = { type: 'json_object' };
    // DeepSeek 等要求消息中带 "json" 字样才返回 JSON
    const last = messages[messages.length - 1];
    last.content += '\n\n(务必只返回一个合法的 JSON 对象，不要包含任何多余文字或 markdown 代码块。)';
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errText = (await response.text()).slice(0, 500);
    throw new Error(`模型接口返回 HTTP ${response.status}：${errText}`);
  }
  const data: any = await response.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  return { text };
}

// ---------------- Gemini 客户端 ----------------

function makeGeminiClient(cfg: LLMConfig): LLMClient {
  const ai = new GoogleGenAI({ apiKey: cfg.apiKey });
  return {
    models: {
      generateContent: async (params: any) => {
        const model = cfg.model || params.model || 'gemini-3.6-flash';
        const resp = await ai.models.generateContent({ ...params, model });
        return { text: resp.text ?? '' };
      },
    },
    chats: { create: () => ({}) },
  } as unknown as LLMClient;
}

// ---------------- 统一客户端构造 ----------------

export function makeLLMClient(cfg: LLMConfig): LLMClient {
  if (cfg.provider === 'gemini') return makeGeminiClient(cfg);
  return {
    models: {
      generateContent: async (params: any) => {
        // openai 兼容模型不支持音频/视频 inline data
        const hasInline = JSON.stringify(params.contents || '').includes('inlineData');
        if (hasInline) {
          throw new Error('当前模型不支持直接解析音频。可改用「导入文本 / 字幕」功能学习该材料。');
        }
        return callOpenAICompatible(cfg, params);
      },
    },
    chats: { create: () => ({}) },
  } as unknown as LLMClient;
}

export class LLMNotConfiguredError extends Error {
  code = 'LLM_NOT_CONFIGURED';
  constructor() {
    super('LLM_NOT_CONFIGURED');
  }
}

/** 按当前登录用户构造 LLM 客户端；未配置 Key 抛 LLM_NOT_CONFIGURED（403）。 */
export async function getLLMClientForRequest(req: Request): Promise<LLMClient> {
  const uid = (req as any).userId as number | undefined;
  if (!uid) throw new HttpError(401, 'UNAUTHORIZED');
  const user = findUserById(uid);
  if (!user) throw new HttpError(401, '用户不存在');
  const cfg = parseLLMConfig(user.llm_json);
  if (!cfg) throw new LLMNotConfiguredError();
  return makeLLMClient(cfg);
}

export function saveUserLLMConfig(userId: number, cfg: LLMConfig | null): void {
  setUserLLMJson(userId, cfg ? serializeLLMConfig(cfg) : '');
}

/** 用给定配置发一条最小请求，验证 Key / baseUrl / model 是否可用。返回模型回复。 */
export async function testLLMConfig(cfg: LLMConfig): Promise<string> {
  if (!cfg.apiKey) throw new Error('请先填写 API Key');
  if (cfg.provider === 'gemini') {
    const client = makeLLMClient(cfg);
    const res = await client.models.generateContent({
      model: cfg.model,
      contents: 'Reply with exactly: OK',
      config: { temperature: 0 },
    });
    return (res.text || '').trim();
  }
  // openai 兼容（含 DeepSeek）
  assertSafeHttpUrlSync(cfg.baseUrl);
  const baseUrl = cfg.baseUrl.replace(/\/+$/, '');
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      max_tokens: 8,
    }),
  });
  if (!response.ok) {
    const errText = (await response.text()).slice(0, 500);
    throw new Error(`HTTP ${response.status}：${errText}`);
  }
  const data: any = await response.json();
  return (data.choices?.[0]?.message?.content ?? '').trim();
}
