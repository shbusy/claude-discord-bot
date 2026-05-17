import { describe, expect, it, vi } from 'vitest';
import { usageCommand } from '../src/bot/commands/usage.js';

vi.mock('../src/usage/db.js', () => ({
  queryUsageSummary: vi.fn(() => ({
    total_input: 1000,
    total_output: 250,
    total_cost: 0.1234,
    count: 3,
  })),
  queryModelBreakdown: vi.fn(() => [{
    model: 'sonnet',
    total_input: 1000,
    total_output: 250,
    total_cost: 0.1234,
  }]),
}));

describe('/a4d usage command', () => {
  it('renders token, cost, count, and model breakdown fields', async () => {
    const reply = vi.fn();
    const interaction = {
      options: {
        getString: () => 'week',
      },
      reply,
    };
    const ctx = {
      config: { cdbHome: '/tmp/cdb' },
    };

    await usageCommand.handle(interaction as never, ctx as never);

    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      ephemeral: true,
      embeds: [expect.anything()],
    }));
    const payload = reply.mock.calls[0]![0];
    const json = payload.embeds[0].toJSON();
    expect(json.title).toBe('📊 사용량 리포트 — 이번 주');
    expect(json.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Input 토큰', value: '1,000' }),
      expect.objectContaining({ name: 'Output 토큰', value: '250' }),
      expect.objectContaining({ name: '총 비용', value: '$0.1234' }),
      expect.objectContaining({ name: '요청 수', value: '3' }),
      expect.objectContaining({ name: '모델별 분포', value: expect.stringContaining('sonnet') }),
    ]));
  });
});
