/**
 * DB 层：Node 内置 node:sqlite（Node ≥ 22.5）。零第三方数据库依赖。
 * 库文件位于 DATA_DIR/app.db（默认 ./data/app.db）。
 */

// 先于其它代码加载 .env（DATA_DIR 等在 db 模块顶层读取）
import 'dotenv/config';

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));

db.exec(`PRAGMA journal_mode = WAL;`);
db.exec(`PRAGMA busy_timeout = 5000;`);
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email      TEXT UNIQUE COLLATE NOCASE,
  pass_salt  TEXT NOT NULL,
  pass_hash  TEXT NOT NULL,
  llm_json   TEXT NOT NULL DEFAULT '',
  asr_json   TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_state (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_state_user ON user_state(user_id);
`);
// Additive migration for existing databases created before ASR settings existed.
const userColumns = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
if (!userColumns.some((column) => column.name === 'asr_json')) {
  db.exec("ALTER TABLE users ADD COLUMN asr_json TEXT NOT NULL DEFAULT ''");
}

export interface UserRow {
  id: number;
  username: string;
  email: string | null;
  pass_salt: string;
  pass_hash: string;
  llm_json: string;
  asr_json: string;
  created_at: string;
}

const stmtUserByName = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE');
const stmtUserByEmail = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE');
const stmtUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const stmtInsertUser = db.prepare(
  'INSERT INTO users (username, email, pass_salt, pass_hash, llm_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
);
const stmtSetLLM = db.prepare('UPDATE users SET llm_json = ? WHERE id = ?');
const stmtSetASR = db.prepare('UPDATE users SET asr_json = ? WHERE id = ?');
const stmtSessionByToken = db.prepare('SELECT * FROM sessions WHERE token = ?');
const stmtInsertSession = db.prepare(
  'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
);
const stmtDeleteSession = db.prepare('DELETE FROM sessions WHERE token = ?');
const stmtDeleteExpired = db.prepare('DELETE FROM sessions WHERE expires_at < ?');
const stmtUpsertState = db.prepare(`
  INSERT INTO user_state (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
`);
const stmtStateAll = db.prepare('SELECT key, value FROM user_state WHERE user_id = ?');
const stmtStateValue = db.prepare('SELECT value FROM user_state WHERE user_id = ? AND key = ?');
const stmtStateSize = db.prepare('SELECT COALESCE(SUM(LENGTH(value)), 0) AS total FROM user_state WHERE user_id = ?');
const stmtDeleteUserState = db.prepare('DELETE FROM user_state WHERE user_id = ?');

export function findUserByUsername(username: string): UserRow | undefined {
  return stmtUserByName.get(username) as unknown as UserRow | undefined;
}
export function findUserByEmail(email: string): UserRow | undefined {
  return stmtUserByEmail.get(email) as unknown as UserRow | undefined;
}
export function findUserById(id: number): UserRow | undefined {
  return stmtUserById.get(id) as unknown as UserRow | undefined;
}

export function insertUser(opts: {
  username: string;
  email: string | null;
  passSalt: string;
  passHash: string;
}): number {
  const now = new Date().toISOString();
  const info = stmtInsertUser.run(opts.username, opts.email, opts.passSalt, opts.passHash, '', now);
  return Number(info.lastInsertRowid);
}

export function setUserLLMJson(id: number, llmJson: string): void {
  stmtSetLLM.run(llmJson, id);
}

export function setUserASRJson(id: number, asrJson: string): void {
  stmtSetASR.run(asrJson, id);
}

/** 持久化会话（服务重启不掉线）。返回 token。 */
export function insertSession(userId: number, token: string, expiresAt: string): void {
  stmtInsertSession.run(token, userId, new Date().toISOString(), expiresAt);
}

export function findSession(token: string) {
  const row = stmtSessionByToken.get(token) as
    | { token: string; user_id: number; created_at: string; expires_at: string }
    | undefined;
  return row;
}

export function deleteSession(token: string): void {
  stmtDeleteSession.run(token);
}

export function sweepExpiredSessions(): void {
  stmtDeleteExpired.run(new Date().toISOString());
}

export function upsertState(userId: number, key: string, value: string): void {
  stmtUpsertState.run(userId, key, value, new Date().toISOString());
}

/** 返回该用户全部状态：{ key: rawValue }（只含本应用 ielts_* 键）。 */
export function getStateSnapshot(userId: number): Record<string, string> {
  const rows = stmtStateAll.all(userId) as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function getStateValue(userId: number, key: string): string | undefined {
  const row = stmtStateValue.get(userId, key) as { value: string } | undefined;
  return row?.value;
}

/** 批量导入若干 key（备份恢复 / 合并本地旧数据），单事务。 */
export function importState(userId: number, entries: [string, string][]): void {
  db.exec('BEGIN');
  try {
    for (const [key, value] of entries) {
      stmtUpsertState.run(userId, key, value, new Date().toISOString());
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/** 当前该用户已存状态的总字符量（用于大小配额）。 */
export function getStateTotalChars(userId: number): number {
  const row = stmtStateSize.get(userId) as { total: number };
  return row?.total ?? 0;
}

export function deleteAllUserState(userId: number): void {
  stmtDeleteUserState.run(userId);
}
