import { describe, expect, it } from 'vitest';
import { SessionManager } from '../src/session/manager.js';
import type { Config } from '../src/config/schema.js';
import { encodeTopic } from '../src/session/topicCodec.js';

const config = {
  discordToken: 't',
  discordClientId: 'c',
  discordGuildId: undefined,
  allowedUserIds: ['u'],
  claudeBin: 'claude',
  defaultModel: 'sonnet',
  permissionMode: 'default',
  defaultLang: 'ko',
  defaultCwd: '/work',
  cdbHome: '/tmp/cdb',
  logLevel: 'info',
  idleTimeoutMs: 300000,
} satisfies Config;

const log = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as never;

describe('SessionManager model switching', () => {
  it('updates the channel model metadata used for the next runner spawn', async () => {
    const sessions = new SessionManager({ config, log });
    await sessions.createSession('channel', {});

    expect(sessions.get('channel')?.meta.model).toBe('sonnet');
    expect(sessions.setModel('channel', 'opus')).toBe(true);
    expect(sessions.get('channel')?.meta.model).toBe('opus');
  });

  it('rejects sessions outside the configured workspace root', async () => {
    const sessions = new SessionManager({ config, log });

    await expect(sessions.createSession('channel', { cwd: '/work/project' })).resolves.toBeDefined();
    await expect(sessions.createSession('other', { cwd: '/etc' })).rejects.toThrow();
  });

  it('rejects topic restore metadata outside the configured workspace root', () => {
    const sessions = new SessionManager({ config, log });
    const topic = encodeTopic({
      sessionId: 's',
      cwd: '/etc',
      model: 'sonnet',
      permissionMode: 'default',
      lastActiveAt: Date.now(),
    });

    expect(sessions.restoreFromTopic('channel', topic)).toBe(false);
  });
});
