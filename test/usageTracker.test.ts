import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/usage/db.js', () => ({
  insertUsage: vi.fn(),
}));

describe('UsageTracker', () => {
  it('treats final result usage as the authoritative total', async () => {
    const { UsageTracker } = await import('../src/usage/tracker.js');
    const { insertUsage } = await import('../src/usage/db.js');
    const tracker = new UsageTracker('/tmp/cdb', {
      sessionId: 's',
      channelId: 'c',
      userId: 'u',
      model: 'sonnet',
    });

    tracker.record({ inputTokens: 10, outputTokens: 5 });
    tracker.record({ inputTokens: 10, outputTokens: 5, costUsd: 0.01, final: true });
    tracker.flush();

    expect(insertUsage).toHaveBeenCalledWith('/tmp/cdb', expect.objectContaining({
      input_tokens: 10,
      output_tokens: 5,
      cost_usd: 0.01,
    }));
  });
});
