import { config as loadDotenv } from 'dotenv';
import { homedir } from 'node:os';
import { ZodError } from 'zod';
import { ConfigSchema, type Config } from './schema.js';
import { defaultCdbHome } from './defaults.js';

let loaded = false;

export async function loadConfig(envPath?: string): Promise<Config> {
  if (envPath) {
    loadDotenv({ path: envPath, override: true });
  } else if (!loaded) {
    loadDotenv();
    loaded = true;
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
  const lines = err.issues.map((issue) => `- ${issue.message}`);
  return [
    '설정이 누락되었거나 잘못되었습니다.',
    ...lines,
    '',
    '다음 명령으로 .env를 생성하거나 점검하세요:',
    '  npm run setup',
    '  npm run doctor',
  ].join('\n');
}
