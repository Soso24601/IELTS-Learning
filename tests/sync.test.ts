import assert from 'node:assert/strict';
import { test, beforeEach, afterEach } from 'node:test';
import { disableSync, enableSync, flushAll, getPendingEntries } from '../frontend/src/lib/sync';
import { clearLocalEntries, setLastAccount, writeLocalEntries } from '../frontend/src/lib/localData';
class MemoryStorage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, String(v)); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}
Object.assign(globalThis, { Storage: MemoryStorage, localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage(), window: new EventTarget() });
const originalFetch = globalThis.fetch;
const handlers = { onAuthLost: () => {} };
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
beforeEach(() => { localStorage.clear(); setLastAccount('alice:1'); });
afterEach(async () => { await disableSync(false); globalThis.fetch = originalFetch; });

test('failed retries survive reload and overlay an older cloud snapshot', async () => {
  const messages: string[] = [];
  globalThis.fetch = async () => { throw new Error('offline'); };
  enableSync({ ...handlers, onError: message => messages.push(message) });
  localStorage.setItem('ielts_vocab_progress', 'new-progress');
  for (let i = 0; i < 5; i++) await flushAll();
  assert.ok(messages.length > 0);
  await disableSync(false);
  const pending = getPendingEntries('alice:1');
  clearLocalEntries();
  writeLocalEntries({ ielts_vocab_progress: 'old-progress' });
  writeLocalEntries(pending);
  assert.equal(localStorage.getItem('ielts_vocab_progress'), 'new-progress');
  const uploads: any[] = [];
  globalThis.fetch = async (_url, init) => { uploads.push(JSON.parse(String(init?.body))); return ok(); };
  enableSync(handlers);
  await flushAll();
  assert.deepEqual(uploads, [{ key: 'ielts_vocab_progress', value: 'new-progress' }]);
  assert.deepEqual(getPendingEntries('alice:1'), {});
});
test('quota errors retain the local pending copy', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'quota' }), { status: 413 });
  enableSync(handlers);
  localStorage.setItem('ielts_material_files', 'material');
  await flushAll();
  assert.deepEqual(getPendingEntries('alice:1'), { ielts_material_files: 'material' });
});
test('switching accounts cannot upload the previous account outbox', async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  enableSync(handlers);
  localStorage.setItem('ielts_custom_vocab', 'alice-words');
  await disableSync(false);
  setLastAccount('bob:2');
  const uploads: any[] = [];
  globalThis.fetch = async (_url, init) => { uploads.push(JSON.parse(String(init?.body))); return ok(); };
  enableSync(handlers);
  localStorage.setItem('ielts_custom_vocab', 'bob-words');
  await flushAll();
  assert.deepEqual(uploads, [{ key: 'ielts_custom_vocab', value: 'bob-words' }]);
  assert.deepEqual(getPendingEntries('alice:1'), { ielts_custom_vocab: 'alice-words' });
});
test('edits during an upload remain pending and are uploaded after the earlier value', async () => {
  let release!: () => void;
  const uploads: any[] = [];
  globalThis.fetch = async (_url, init) => {
    uploads.push(JSON.parse(String(init?.body)));
    if (uploads.length === 1) await new Promise<void>(resolve => { release = resolve; });
    return ok();
  };
  enableSync(handlers);
  localStorage.setItem('ielts_vocab_progress', 'v1');
  const first = flushAll();
  localStorage.setItem('ielts_vocab_progress', 'v2');
  release();
  await first;
  assert.deepEqual(getPendingEntries('alice:1'), { ielts_vocab_progress: 'v2' });
  await flushAll();
  assert.deepEqual(uploads.map(u => u.value), ['v1', 'v2']);
  assert.deepEqual(getPendingEntries('alice:1'), {});
});
test('local account markers and sessionStorage are never uploaded', async () => {
  const uploads: any[] = [];
  globalThis.fetch = async (_url, init) => { uploads.push(init); return ok(); };
  enableSync(handlers);
  setLastAccount('alice:1');
  sessionStorage.setItem('ielts_custom_vocab', 'temporary');
  await flushAll();
  assert.deepEqual(uploads, []);
});
