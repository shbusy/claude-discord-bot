import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigSchema } from '../src/config/schema.js';
import { formatConfigError, loadConfig } from '../src/config/load.js';
import { defaultCdbHome } from '../src/config/defaults.js';

describe('config error formatting', () => {
  it('turns zod config errors into actionable setup guidance', () => {
    let err: unknown;
    try {
      ConfigSchema.parse({
        discordToken: '',
        discordClientId: '',
        allowedUserIds: [],
        defaultCwd: '/tmp',
        cdbHome: '/tmp/cdb',
      });
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(ZodError);
    expect(formatConfigError(err)).toContain('npm run setup');
  });

  it('treats a blank CDB_HOME from .env as the default data directory', () => {
    const previous = process.env.CDB_HOME;
    process.env.CDB_HOME = '';
    try {
      expect(defaultCdbHome()).toMatch(/\.claude-discord-bot$/);
    } finally {
      if (previous === undefined) {
        delete process.env.CDB_HOME;
      } else {
        process.env.CDB_HOME = previous;
      }
    }
  });

  it('rejects empty allowlists and bypass permission mode', () => {
    expect(() => ConfigSchema.parse({
      discordToken: 't',
      discordClientId: 'c',
      allowedUserIds: [],
      defaultCwd: '/tmp',
      cdbHome: '/tmp/cdb',
    })).toThrow();

    expect(() => ConfigSchema.parse({
      discordToken: 't',
      discordClientId: 'c',
      allowedUserIds: ['u'],
      permissionMode: 'bypassPermissions',
      defaultCwd: '/tmp',
      cdbHome: '/tmp/cdb',
    })).toThrow();
  });

  it('can load config from an explicit env path for live e2e commands', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cdb-config-'));
    const envPath = join(dir, '.env.live');
    await writeFile(envPath, [
      'DISCORD_TOKEN=token-from-file',
      'DISCORD_CLIENT_ID=client-from-file',
      'ALLOWED_USER_IDS=user-from-file',
      'DEFAULT_MODEL=haiku',
      '',
    ].join('\n'));

    const previous = {
      DISCORD_TOKEN: process.env.DISCORD_TOKEN,
      DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID,
      ALLOWED_USER_IDS: process.env.ALLOWED_USER_IDS,
      DEFAULT_MODEL: process.env.DEFAULT_MODEL,
    };
    try {
      const cfg = await loadConfig(envPath);
      expect(cfg.discordToken).toBe('token-from-file');
      expect(cfg.discordClientId).toBe('client-from-file');
      expect(cfg.allowedUserIds).toEqual(['user-from-file']);
      expect(cfg.defaultModel).toBe('haiku');
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
