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

  it('records first-call cache stats and turn start info', async () => {
    const { UsageTracker } = await import('../src/usage/tracker.js');
    const { insertUsage } = await import('../src/usage/db.js');
    const tracker = new UsageTracker('/tmp/cdb', { sessionId: 's', channelId: 'c' });

    tracker.setTurnStart({ spawned: false, idleMs: 600_000 });
    tracker.record({ inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 300, cacheReadInputTokens: 250_000 });
    tracker.record({ inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 50_000, cacheReadInputTokens: 250_300 });
    tracker.record({ inputTokens: 2, outputTokens: 2, costUsd: 0.2, final: true });
    tracker.flush();

    expect(insertUsage).toHaveBeenLastCalledWith('/tmp/cdb', expect.objectContaining({
      first_cache_creation_tokens: 300,
      first_cache_read_tokens: 250_000,
      spawned: 0,
      idle_ms: 600_000,
    }));
  });
});
