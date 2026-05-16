import { config as loadDotenv } from 'dotenv';
import { ConfigSchema, type Config } from './schema.js';
import { defaultCdbHome } from './defaults.js';

let loaded = false;

export async function loadConfig(): Promise<Config> {
  if (!loaded) {
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
    defaultLang: process.env.DEFAULT_LANG || 'ko',
    cdbHome: defaultCdbHome(),
    logLevel: process.env.LOG_LEVEL || 'info',
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
