import { describe, expect, it, vi } from 'vitest';

const put = vi.fn(async () => undefined);
const setToken = vi.fn(() => ({ put }));

vi.mock('discord.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('discord.js')>();
  return {
    ...actual,
    REST: vi.fn(() => ({ setToken })),
  };
});

describe('slash command registration', () => {
  it('submits both /cdb and /a4d command bodies to Discord REST', async () => {
    const { registerSlashCommands } = await import('../src/bot/register.js');
    const log = { info: vi.fn() };

    await registerSlashCommands({
      discordToken: 'token',
      discordClientId: 'client',
      discordGuildId: 'guild',
      allowedUserIds: ['user'],
      claudeBin: 'claude',
      defaultModel: 'sonnet',
      permissionMode: 'default',
      defaultLang: 'ko',
      defaultCwd: '/work',
      cdbHome: '/tmp/cdb',
      logLevel: 'info',
      idleTimeoutMs: 300000,
    }, log as never);

    expect(setToken).toHaveBeenCalledWith('token');
    expect(put).toHaveBeenCalledOnce();
    const call = put.mock.calls[0] as unknown as [string, { body: Array<{ name: string }> }];
    expect(call[1].body.map((cmd) => cmd.name)).toEqual(['cdb', 'a4d']);
  });
});
