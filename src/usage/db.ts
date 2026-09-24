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
  migrate(db);
  return db;
}

/**
 * 턴 첫 API 호출의 캐시 수치. 턴 전체 합계는 도구 루프 호출이 섞여 있어
 * "이번 턴이 캐시를 탔는가"를 판단할 수 없으므로 따로 남긴다.
 */
const TURN_COLUMNS: Array<[string, string]> = [
  ['first_cache_creation_tokens', 'INTEGER'],
  ['first_cache_read_tokens', 'INTEGER'],
  ['spawned', 'INTEGER'],
  ['idle_ms', 'INTEGER'],
];

function migrate(d: Database.Database): void {
  const existing = new Set(
    (d.prepare('PRAGMA table_info(usage)').all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const [name, type] of TURN_COLUMNS) {
    if (!existing.has(name)) d.exec(`ALTER TABLE usage ADD COLUMN ${name} ${type}`);
  }
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
  first_cache_creation_tokens?: number | null;
  first_cache_read_tokens?: number | null;
  spawned?: number | null;
  idle_ms?: number | null;
  ts: string;
}

export function insertUsage(cdbHome: string, row: Omit<UsageRow, 'ts'>): void {
  const d = getDb(cdbHome);
  const stmt = d.prepare(`
    INSERT INTO usage (session_id, channel_id, user_id, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd,
                       first_cache_creation_tokens, first_cache_read_tokens, spawned, idle_ms)
    VALUES (@session_id, @channel_id, @user_id, @model, @input_tokens, @output_tokens, @cache_creation_tokens, @cache_read_tokens, @cost_usd,
            @first_cache_creation_tokens, @first_cache_read_tokens, @spawned, @idle_ms)
  `);
  stmt.run({
    first_cache_creation_tokens: null,
    first_cache_read_tokens: null,
    spawned: null,
    idle_ms: null,
    ...row,
  });
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

/** 이 시간보다 짧게 쉬었으면 캐시가 살아 있어야 한다 (1h TTL에 여유를 둔 값). */
export const WARM_WINDOW_MS = 55 * 60 * 1000;
/** 첫 호출 cache write가 이보다 크고 read보다 크면 대화 전체를 다시 기록한 것으로 본다. */
export const MISS_WRITE_THRESHOLD = 20_000;

export interface CacheStats {
  turns: number;
  first_read: number;
  first_creation: number;
  warm_turns: number;
  warm_misses: number;
  warm_miss_tokens: number;
}

/** 턴 첫 호출 기준 캐시 적중 통계. 측정 컬럼이 채워진 턴만 집계한다. */
export function queryCacheStats(cdbHome: string, period: 'day' | 'week' | 'month'): CacheStats {
  const d = getDb(cdbHome);
  const offsetMap = { day: '-1 day', week: '-7 days', month: '-30 days' } as const;
  const isWarm = `idle_ms IS NOT NULL AND idle_ms < ${WARM_WINDOW_MS}`;
  const isMiss = `first_cache_creation_tokens > ${MISS_WRITE_THRESHOLD} AND first_cache_creation_tokens > first_cache_read_tokens`;
  return d
    .prepare(
      `SELECT
        COUNT(*) AS turns,
        COALESCE(SUM(first_cache_read_tokens), 0) AS first_read,
        COALESCE(SUM(first_cache_creation_tokens), 0) AS first_creation,
        COALESCE(SUM(CASE WHEN ${isWarm} THEN 1 ELSE 0 END), 0) AS warm_turns,
        COALESCE(SUM(CASE WHEN ${isWarm} AND ${isMiss} THEN 1 ELSE 0 END), 0) AS warm_misses,
        COALESCE(SUM(CASE WHEN ${isWarm} AND ${isMiss} THEN first_cache_creation_tokens ELSE 0 END), 0) AS warm_miss_tokens
      FROM usage
      WHERE ts >= datetime('now', ?) AND first_cache_read_tokens IS NOT NULL`,
    )
    .get(offsetMap[period]) as CacheStats;
}
