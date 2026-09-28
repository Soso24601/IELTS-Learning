/**
 * 本地数据工具：所有学习数据都以 localStorage 的 `ielts_*` 键为"事实源"，
 * 这里提供对这些键的批量读 / 清空 / 写入 / 导入，供登录门卫与备份功能使用。
 */

export const LS_PREFIX = 'ielts_';
export const LAST_ACCOUNT_KEY = 'ielts_last_account';

export function listLocalEntries(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    // 跳过纯本地的"最近登录账号"标记，它不应进入云端数据
    if (k && k.startsWith(LS_PREFIX) && k !== LAST_ACCOUNT_KEY) {
      const v = localStorage.getItem(k);
      if (v !== null) out[k] = v;
    }
  }
  return out;
}

export function countLocalEntries(): number {
  return Object.keys(listLocalEntries()).length;
}

export function clearLocalEntries(): void {
  for (const k of Object.keys(listLocalEntries())) {
    localStorage.removeItem(k);
  }
}

/** 把一组 { key: rawValue } 写回本地（用于服务端快照回灌）。 */
export function writeLocalEntries(map: Record<string, string>): void {
  for (const [k, v] of Object.entries(map)) {
    if (k.startsWith(LS_PREFIX) && k !== LAST_ACCOUNT_KEY) localStorage.setItem(k, v);
  }
}

/** 记录本浏览器最近一次登录的账号（用于判断"遗留本地数据可否导入新账号"）。 */
export function getLastAccount(): string | null {
  return localStorage.getItem(LAST_ACCOUNT_KEY);
}
export function setLastAccount(account: string): void {
  localStorage.setItem(LAST_ACCOUNT_KEY, account);
}
