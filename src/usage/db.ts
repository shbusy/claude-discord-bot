import Database from 'better-sqlite3';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage(ts);
CREATE INDEX IF NOT EXISTS idx_usage_channel ON usage(channel_id);
CREATE INDEX IF NOT EXISTS idx_usage_session ON usage(session_id);
`;

let db: Database.Database | null = null;

export function getDb(cdbHome: string): Database.Database {
  if (db) return db;
  mkdirSync(cdbHome, { recursive: true });
  const dbPath = join(cdbHome, 'usage.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export interface UsageRow {
  session_id: string;
  channel_id: string;
  user_id: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  cost_usd: number | null;
  ts: string;
}

export function insertUsage(cdbHome: string, row: Omit<UsageRow, 'ts'>): void {
  const d = getDb(cdbHome);
  const stmt = d.prepare(`
    INSERT INTO usage (session_id, channel_id, user_id, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd)
    VALUES (@session_id, @channel_id, @user_id, @model, @input_tokens, @output_tokens, @cache_creation_tokens, @cache_read_tokens, @cost_usd)
  `);
  stmt.run(row);
}

export interface UsageSummary {
  total_input: number;
  total_output: number;
  total_cost: number;
  count: number;
}

export function queryUsageSummary(
  cdbHome: string,
  period: 'day' | 'week' | 'month',
  channelId?: string,
): UsageSummary {
  const d = getDb(cdbHome);
  const offsetMap = { day: '-1 day', week: '-7 days', month: '-30 days' } as const;
  const offset = offsetMap[period];

  let sql = `
    SELECT
      COALESCE(SUM(input_tokens), 0) AS total_input,
      COALESCE(SUM(output_tokens), 0) AS total_output,
      COALESCE(SUM(cost_usd), 0) AS total_cost,
      COUNT(*) AS count
    FROM usage
    WHERE ts >= datetime('now', ?)
  `;
  const params: unknown[] = [offset];

  if (channelId) {
    sql += ' AND channel_id = ?';
    params.push(channelId);
  }

  return d.prepare(sql).get(...params) as UsageSummary;
}

export interface ModelBreakdown {
  model: string;
  total_input: number;
  total_output: number;
  total_cost: number;
}

export function queryModelBreakdown(
  cdbHome: string,
  period: 'day' | 'week' | 'month',
): ModelBreakdown[] {
  const d = getDb(cdbHome);
  const offsetMap = { day: '-1 day', week: '-7 days', month: '-30 days' } as const;
  return d
    .prepare(
      `SELECT
        COALESCE(model, 'unknown') AS model,
        COALESCE(SUM(input_tokens), 0) AS total_input,
        COALESCE(SUM(output_tokens), 0) AS total_output,
        COALESCE(SUM(cost_usd), 0) AS total_cost
      FROM usage
      WHERE ts >= datetime('now', ?)
      GROUP BY model
      ORDER BY total_cost DESC`,
    )
    .all(offsetMap[period]) as ModelBreakdown[];
}
