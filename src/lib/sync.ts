/**
 * 同步引擎：登录后启用，拦截对 `ielts_*` localStorage 键的写入，
 * 逐 key debounce 后上传到服务端（/api/data/key）。登录时由门卫回灌快照。
 *
 * 数据流：组件照旧写 localStorage（事实源不变）→ 本模块异步同步到账号云端。
 * 因此 6 大学习模块的数据读写代码无需改动。
 */

import { apiUploadKey } from './authApi';
import { LS_PREFIX, listLocalEntries } from './localData';

const DEBOUNCE_MS = 1200;
const MAX_ATTEMPTS = 4;

export interface SyncHandlers {
  /** 收到 401（会话失效）时回调，通常由根组件切回登录页。 */
  onAuthLost: () => void;
  /** 非致命错误（如超出配额）回调，用于提示用户。 */
  onError?: (message: string) => void;
}

let active = false;
let hydrating = false;
let patched = false;
let handlers: SyncHandlers | null = null;

const dirty = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const attempts = new Map<string, number>();

export function setHydrating(v: boolean): void {
  hydrating = v;
}

function isEligibleKey(key: string): boolean {
  return key.startsWith(LS_PREFIX) && !key.endsWith('_pending_upload');
}

async function uploadKey(key: string, value: string): Promise<boolean> {
  try {
    await apiUploadKey(key, value);
    return true;
  } catch (e: any) {
    if (e?.status === 401) {
      handlers?.onAuthLost();
      return false;
    }
    if (e?.status === 413) {
      handlers?.onError?.(e.message || '数据超过账号存储上限');
      dirty.delete(key); // 重试无意义
      return false;
    }
    throw e;
  }
}

function scheduleFlush(key: string): void {
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(
    key,
    setTimeout(() => {
      void flushKey(key);
    }, DEBOUNCE_MS),
  );
}

function markDirty(key: string): void {
  dirty.add(key);
  attempts.delete(key);
  scheduleFlush(key);
}

async function flushKey(key: string): Promise<void> {
  timers.delete(key);
  if (!active) return;
  const value = localStorage.getItem(key);
  if (value === null) {
    dirty.delete(key);
    attempts.delete(key);
    return;
  }
  const round = attempts.get(key) || 0;
  try {
    const ok = await uploadKey(key, value);
    if (ok) {
      dirty.delete(key);
      attempts.delete(key);
    }
  } catch {
    attempts.set(key, round + 1);
    if (round + 1 <= MAX_ATTEMPTS) {
      const delay = Math.min(1500 * 2 ** round, 30000);
      timers.set(
        key,
        setTimeout(() => void flushKey(key), delay),
      );
    } else {
      dirty.delete(key);
      attempts.delete(key);
    }
  }
}

/** 立刻把当前所有 pending 的 key 上传（登录/登出前调用）。 */
export async function flushAll(): Promise<void> {
  const keys = [...dirty];
  for (const key of keys) {
    const t = timers.get(key);
    if (t) clearTimeout(t);
    timers.delete(key);
    const value = localStorage.getItem(key);
    if (value === null) {
      dirty.delete(key);
      attempts.delete(key);
      continue;
    }
    try {
      const ok = await uploadKey(key, value);
      if (ok) {
        dirty.delete(key);
        attempts.delete(key);
      }
    } catch {
      attempts.set(key, (attempts.get(key) || 0) + 1);
      if ((attempts.get(key) || 0) <= MAX_ATTEMPTS) scheduleFlush(key);
    }
  }
}

/** 页面关闭前的尽力兜底：把脏数据用 sendBeacon 一次性推到服务器。 */
export function beaconDirty(): void {
  if (!active || dirty.size === 0) return;
  const data: Record<string, string> = {};
  for (const key of dirty) {
    const v = localStorage.getItem(key);
    if (v !== null) data[key] = v;
  }
  if (Object.keys(data).length === 0) return;
  try {
    const blob = new Blob([JSON.stringify({ data })], { type: 'application/json' });
    navigator.sendBeacon('/api/data/import', blob);
  } catch {
    /* ignore */
  }
}

function onOnline(): void {
  if (!active) return;
  for (const key of dirty) scheduleFlush(key);
}
function onPageHide(): void {
  beaconDirty();
}

/** 登录完成后启用同步（幂等）。若已经启用则只刷新处理器。 */
export function enableSync(h: SyncHandlers): void {
  handlers = h;
  if (!patched) {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      original.call(this, key, value);
      if (active && !hydrating && isEligibleKey(key)) markDirty(key);
    };
    patched = true;
  }
  if (!active) {
    active = true;
    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', onPageHide);
  }
}

/** 登出 / 切号前调用。flush=true 时先尽力把 pending 数据上传；会话失效路径传 false。 */
export async function disableSync(flush = true): Promise<void> {
  if (active && flush) {
    await flushAll();
  }
  active = false;
  handlers = null;
  window.removeEventListener('online', onOnline);
  window.removeEventListener('pagehide', onPageHide);
}

/** 把当前浏览器里所有 `ielts_*` 一键推到当前账号（旧数据自动导入用）。 */
export async function pushLocalAllToServer(onError?: (msg: string) => void): Promise<boolean> {
  const entries = listLocalEntries();
  const keys = Object.keys(entries);
  if (keys.length === 0) return true;
  try {
    await import('./authApi').then((m) => m.apiImport(entries));
    return true;
  } catch (e: any) {
    if (e?.status === 401) {
      handlers?.onAuthLost();
    } else if (e?.status === 413) {
      onError?.(e?.message || '数据超出账号存储上限，导入失败');
    }
    return false;
  }
}
