/** Account-scoped durable outbox. Failed writes survive reloads and account changes. */
import { apiUploadKey } from './authApi';
import { apiFetch } from './apiUrl';
import { LS_PREFIX, LAST_ACCOUNT_KEY, getLastAccount, listLocalEntries } from './localData';

const DEBOUNCE_MS = 1200;
const MAX_ATTEMPTS = 4;
export interface SyncHandlers {
  onAuthLost: () => void;
  onError?: (message: string) => void;
  onPendingChange?: (count: number) => void;
}
interface Session {
  account: string;
  handlers: SyncHandlers;
  pending: Record<string, string>;
  timers: Map<string, ReturnType<typeof setTimeout>>;
  attempts: Map<string, number>;
  flights: Map<string, Promise<void>>;
  controllers: Set<AbortController>;
}
let session: Session | null = null;
let hydrating = false;
let patched = false;
const outboxKey = (account: string) => `ielts-sync-outbox:${account}`;
const eligible = (key: string) => key.startsWith(LS_PREFIX) && key !== LAST_ACCOUNT_KEY && !key.endsWith('_pending_upload');

export function setHydrating(value: boolean): void { hydrating = value; }

/** Overlay only this account's unsent changes before cloud hydration. */
export function getPendingEntries(account: string): Record<string, string> {
  const raw = localStorage.getItem(outboxKey(account));
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('本地待同步数据格式异常，请先保留浏览器数据');
  return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => eligible(key) && typeof value === 'string')) as Record<string, string>;
}

function persist(s: Session): void {
  try {
    if (Object.keys(s.pending).length) localStorage.setItem(outboxKey(s.account), JSON.stringify(s.pending));
    else localStorage.removeItem(outboxKey(s.account));
  } catch {
    s.handlers.onError?.('浏览器存储空间不足，待同步内容暂时无法备份；请保持页面开启并导出备份。');
  }
  if (session === s) s.handlers.onPendingChange?.(Object.keys(s.pending).length);
}

function schedule(s: Session, key: string, delay = DEBOUNCE_MS): void {
  if (session !== s) return;
  clearTimeout(s.timers.get(key));
  s.timers.set(key, setTimeout(() => { void flushKey(s, key); }, delay));
}

function markDirty(s: Session, key: string, value: string): void {
  s.pending[key] = value;
  s.attempts.delete(key);
  persist(s);
  schedule(s, key);
}

async function flushKey(s: Session, key: string): Promise<void> {
  clearTimeout(s.timers.get(key));
  s.timers.delete(key);
  if (session !== s || !(key in s.pending)) return;
  // Serialize each key so an older request cannot overwrite a newer value.
  const previous = s.flights.get(key);
  if (previous) {
    await previous;
    if (session === s && key in s.pending) return flushKey(s, key);
    return;
  }
  const value = s.pending[key];
  const controller = new AbortController();
  s.controllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), 15000);
  const flight = (async () => {
    try {
      await apiUploadKey(key, value, controller.signal);
      if (session !== s) return;
      if (s.pending[key] === value) {
        delete s.pending[key];
        s.attempts.delete(key);
        persist(s);
      } else schedule(s, key);
    } catch (error: any) {
      if (session !== s) return;
      if (error?.status === 401) {
        s.handlers.onAuthLost();
      } else if (error?.status === 413) {
        s.handlers.onError?.('云端存储空间不足，内容仍保存在本机待同步队列；请导出备份或减少材料后重试。');
      } else {
        const attempt = (s.attempts.get(key) || 0) + 1;
        s.attempts.set(key, attempt);
        if (attempt <= MAX_ATTEMPTS) schedule(s, key, Math.min(1500 * 2 ** (attempt - 1), 30000));
        else s.handlers.onError?.('同步失败，内容已保留在本机，联网后会重试，也可以手动重试。');
      }
    } finally {
      clearTimeout(timeout);
      s.controllers.delete(controller);
    }
  })();
  s.flights.set(key, flight);
  try { await flight; } finally { s.flights.delete(key); }
}

export async function flushAll(): Promise<void> {
  const s = session;
  if (!s) return;
  await Promise.all(Object.keys(s.pending).map(key => flushKey(s, key)));
}

export function beaconDirty(): void {
  const s = session;
  if (!s || !Object.keys(s.pending).length) return;
  // A beacon has no acknowledgement. Keep the durable outbox until a normal upload succeeds.
  try {
    void apiFetch('/api/data/import', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: s.pending }),
    });
  } catch { /* the outbox remains available on next login */ }
}
function onOnline(): void {
  const s = session;
  if (!s) return;
  s.attempts.clear();
  for (const key of Object.keys(s.pending)) schedule(s, key);
}
function onPageHide(): void { beaconDirty(); }

export function enableSync(handlers: SyncHandlers): void {
  const account = getLastAccount();
  if (!account) throw new Error('无法确认同步账号');
  if (session?.account === account) {
    session.handlers = handlers;
    handlers.onPendingChange?.(Object.keys(session.pending).length);
    return;
  }
  if (session) throw new Error('切换账号前必须停止旧账号同步');
  const s: Session = { account, handlers, pending: getPendingEntries(account), timers: new Map(), attempts: new Map(), flights: new Map(), controllers: new Set() };
  session = s;
  if (!patched) {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      original.call(this, key, value);
      if (this === localStorage && session && !hydrating && eligible(key)) markDirty(session, key, value);
    };
    patched = true;
  }
  window.addEventListener('online', onOnline);
  window.addEventListener('pagehide', onPageHide);
  handlers.onPendingChange?.(Object.keys(s.pending).length);
  onOnline();
}

export async function disableSync(flush = true): Promise<void> {
  const s = session;
  if (!s) return;
  if (flush) await flushAll();
  if (session !== s) return;
  session = null;
  for (const timer of s.timers.values()) clearTimeout(timer);
  for (const controller of s.controllers) controller.abort();
  window.removeEventListener('online', onOnline);
  window.removeEventListener('pagehide', onPageHide);
}

export async function pushLocalAllToServer(onError?: (message: string) => void): Promise<boolean> {
  const s = session;
  if (!s) return false;
  for (const [key, value] of Object.entries(listLocalEntries())) if (eligible(key)) markDirty(s, key, value);
  await flushAll();
  const ok = Object.keys(s.pending).length === 0;
  if (!ok) onError?.('部分内容尚未同步，已保留本地副本。');
  return ok;
}
