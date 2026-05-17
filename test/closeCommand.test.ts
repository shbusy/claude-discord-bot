import { describe, expect, it, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import { closeCommand } from '../src/bot/commands/close.js';

describe('/a4d close command', () => {
  it('closes the channel session before deleting the text channel', async () => {
    const calls: string[] = [];
    const interaction = {
      channelId: 'channel',
      channel: {
        type: ChannelType.GuildText,
        delete: vi.fn(async () => {
          calls.push('delete');
        }),
      },
      reply: vi.fn(async () => {
        calls.push('reply');
      }),
    };
    const ctx = {
      sessions: {
        get: () => undefined,
        restoreFromTopic: () => false,
        close: vi.fn(async () => {
          calls.push('close');
          return true;
        }),
      },
      log: { warn: vi.fn() },
    };

    await closeCommand.handle(interaction as never, ctx as never);

    expect(ctx.sessions.close).toHaveBeenCalledWith('channel');
    expect(interaction.channel.delete).toHaveBeenCalledWith('CDB session closed');
    expect(calls).toEqual(['reply', 'close', 'delete']);
  });
});
