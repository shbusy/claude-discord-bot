import { describe, expect, it, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import { postUsageUpdate } from '../src/bot/events/messageCreate.js';
import { PRIMARY_USAGE_CHANNEL_NAME } from '../src/bot/channelNames.js';

describe('usage update posting', () => {
  it('posts session usage and rate-limit info to #a4d-usage', async () => {
    const send = vi.fn();
    const channel = {
      id: 'session-channel',
      guild: {
        channels: {
          cache: [
            { type: ChannelType.GuildText, name: PRIMARY_USAGE_CHANNEL_NAME, send },
          ],
        },
      },
    };

    await postUsageUpdate(channel as never, {
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.01,
    }, {
      status: 'limited',
      rateLimitType: 'tokens',
      utilization: 0.8,
      resetsAt: Date.UTC(2026, 0, 1),
    });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      embeds: [expect.anything()],
    }));
    const embed = send.mock.calls[0]![0].embeds[0].toJSON();
    expect(embed.title).toBe('📊 세션 사용량');
    expect(embed.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: '채널', value: '<#session-channel>' }),
      expect.objectContaining({ name: 'Input', value: '10' }),
      expect.objectContaining({ name: 'Output', value: '5' }),
      expect.objectContaining({ name: 'Cost', value: '$0.0100' }),
      expect.objectContaining({ name: 'Rate limit', value: expect.stringContaining('limited') }),
    ]));
  });
});
