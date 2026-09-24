import { config as loadDotenv } from 'dotenv';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import { ConfigSchema, type Config } from './schema.js';
import { defaultCdbHome } from './defaults.js';

let loaded = false;
let lastEnvPath = '';

/** 설정 오류 전용 종료 코드(sysexits의 EX_CONFIG). 재시도해도 낫지 않는 영구 오류를 뜻한다. */
export const EXIT_CONFIG_ERROR = 78;

/** Config 필드 → .env 키. 오류 메시지에서 "어떤 환경변수가 문제인지" 짚어주는 용도. */
const ENV_KEY_BY_FIELD: Record<string, string> = {
  discordToken: 'DISCORD_TOKEN',
  discordClientId: 'DISCORD_CLIENT_ID',
  discordGuildId: 'DISCORD_GUILD_ID',
  allowedUserIds: 'ALLOWED_USER_IDS',
  claudeBin: 'CLAUDE_BIN',
  defaultModel: 'DEFAULT_MODEL',
  permissionMode: 'PERMISSION_MODE',
  defaultLang: 'DEFAULT_LANG',
  thinkingLang: 'THINKING_LANG',
  defaultCwd: 'DEFAULT_CWD',
  cdbHome: 'CDB_HOME',
  logLevel: 'LOG_LEVEL',
  idleTimeoutMs: 'IDLE_TIMEOUT_MS',
};

/** 현재 값을 그대로 찍으면 안 되는 필드 */
const SECRET_FIELDS = new Set(['discordToken']);

export async function loadConfig(envPath?: string): Promise<Config> {
  if (envPath) {
    loadDotenv({ path: envPath, override: true });
    lastEnvPath = resolve(envPath);
  } else if (!loaded) {
    loadDotenv();
    loaded = true;
    lastEnvPath = resolve(process.cwd(), '.env');
  }
  const parsed = ConfigSchema.parse({
    discordToken: process.env.DISCORD_TOKEN ?? '',
    discordClientId: process.env.DISCORD_CLIENT_ID ?? '',
    discordGuildId: process.env.DISCORD_GUILD_ID || undefined,
    allowedUserIds: splitCsv(process.env.ALLOWED_USER_IDS),
    claudeBin: process.env.CLAUDE_BIN || 'claude',
    defaultModel: process.env.DEFAULT_MODEL || 'sonnet',
    permissionMode: process.env.PERMISSION_MODE || 'default',
    defaultLang: process.env.DEFAULT_LANG || 'ko',
    thinkingLang: process.env.THINKING_LANG || 'off',
    defaultCwd: process.env.DEFAULT_CWD || homedir(),
    cdbHome: defaultCdbHome(),
    logLevel: process.env.LOG_LEVEL || 'info',
    idleTimeoutMs: process.env.IDLE_TIMEOUT_MS ? Number(process.env.IDLE_TIMEOUT_MS) : undefined,
  });
  return parsed;
}

function splitCsv(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function formatConfigError(err: unknown): string | null {
  if (!(err instanceof ZodError)) return null;
  const lines = err.issues.map((issue) => {
    const field = String(issue.path[0] ?? '');
    const envKey = ENV_KEY_BY_FIELD[field];
    const label = envKey ?? field ?? '(알 수 없는 항목)';
    return `- ${label}: ${issue.message}${formatActualValue(field, envKey)}`;
  });
  return [
    '설정이 누락되었거나 잘못되었습니다.',
    ...(lastEnvPath ? [`읽은 파일: ${lastEnvPath}`] : []),
    ...lines,
    '',
    '다음 명령으로 .env를 생성하거나 점검하세요:',
    '  npm run setup',
    '  npm run doctor',
  ].join('\n');
}

function formatActualValue(field: string, envKey: string | undefined): string {
  if (!envKey) return '';
  if (SECRET_FIELDS.has(field)) return '';
  const actual = process.env[envKey];
  if (actual === undefined) return ' (현재: 미설정)';
  return ` (현재 값: "${actual}")`;
}
