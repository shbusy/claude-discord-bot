import { describe, expect, it } from 'vitest';
import { PermissionFlagsBits } from 'discord.js';
import { buildInviteUrl, nextSteps, renderEnv } from '../src/setup.js';

describe('setup', () => {
  it('renders an env file compatible with the runtime config loader', () => {
    const env = renderEnv({
      discordToken: 'token',
      discordClientId: 'client',
      discordGuildId: 'guild',
      allowedUserIds: 'user1,user2',
      defaultModel: 'sonnet',
      permissionMode: 'default',
      defaultCwd: '/work',
    });

    expect(env).toContain('DISCORD_TOKEN=token');
    expect(env).toContain('DISCORD_CLIENT_ID=client');
    expect(env).toContain('ALLOWED_USER_IDS=user1,user2');
    expect(env).toContain('PERMISSION_MODE=default');
    expect(env).toContain('DEFAULT_CWD=/work');
  });

  it('builds a Discord invite URL with bot and slash-command scopes', () => {
    const url = new URL(buildInviteUrl('123'));
    expect(url.hostname).toBe('discord.com');
    expect(url.searchParams.get('client_id')).toBe('123');
    expect(url.searchParams.get('scope')).toBe('bot applications.commands');
    const permissions = BigInt(url.searchParams.get('permissions') ?? '0');
    expect((permissions & PermissionFlagsBits.AttachFiles) !== 0n).toBe(true);
    expect((permissions & PermissionFlagsBits.SendMessagesInThreads) !== 0n).toBe(true);
    expect((permissions & PermissionFlagsBits.AddReactions) !== 0n).toBe(true);
  });

  it('prints current npm script next steps', () => {
    expect(nextSteps()).toBe('Next: npm run doctor && npm run register && npm run run:bot');
  });
});
