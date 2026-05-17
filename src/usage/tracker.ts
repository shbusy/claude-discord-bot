import type { UsageDelta } from '../claude/types.js';
import { insertUsage } from './db.js';

export interface TrackingContext {
  sessionId: string;
  channelId: string;
  userId?: string;
  model?: string;
}

/**
 * Tracks usage events from a runner and persists to SQLite.
 * Batches writes per session turn (accumulates deltas, flushes on end).
 */
export class UsageTracker {
  private accumulated: UsageDelta = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    costUsd: undefined,
  };

  constructor(
    private readonly cdbHome: string,
    private readonly trackCtx: TrackingContext,
  ) {}

  /** Update the sessionId (e.g. after init event populates it). */
  updateSessionId(sessionId: string): void {
    this.trackCtx.sessionId = sessionId;
  }

  /** Accumulate a usage delta (called per assistant message). */
  record(delta: UsageDelta): void {
    if (delta.final) {
      this.accumulated = {
        inputTokens: delta.inputTokens,
        outputTokens: delta.outputTokens,
        cacheCreationInputTokens: delta.cacheCreationInputTokens ?? 0,
        cacheReadInputTokens: delta.cacheReadInputTokens ?? 0,
        costUsd: delta.costUsd,
        final: true,
      };
      return;
    }
    this.accumulated.inputTokens += delta.inputTokens;
    this.accumulated.outputTokens += delta.outputTokens;
    this.accumulated.cacheCreationInputTokens =
      (this.accumulated.cacheCreationInputTokens ?? 0) + (delta.cacheCreationInputTokens ?? 0);
    this.accumulated.cacheReadInputTokens =
      (this.accumulated.cacheReadInputTokens ?? 0) + (delta.cacheReadInputTokens ?? 0);
    if (typeof delta.costUsd === 'number') {
      this.accumulated.costUsd = delta.costUsd; // result event has the total
    }
  }

  /** Flush accumulated usage to the database. Call after turn ends. */
  flush(): void {
    if (this.accumulated.inputTokens === 0 && this.accumulated.outputTokens === 0) return;
    try {
      insertUsage(this.cdbHome, {
        session_id: this.trackCtx.sessionId,
        channel_id: this.trackCtx.channelId,
        user_id: this.trackCtx.userId ?? null,
        model: this.trackCtx.model ?? null,
        input_tokens: this.accumulated.inputTokens,
        output_tokens: this.accumulated.outputTokens,
        cache_creation_tokens: this.accumulated.cacheCreationInputTokens ?? 0,
        cache_read_tokens: this.accumulated.cacheReadInputTokens ?? 0,
        cost_usd: this.accumulated.costUsd ?? null,
      });
    } catch {
      // DB write failure — logged by caller, not critical
    }
    this.reset();
  }

  private reset(): void {
    this.accumulated = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      costUsd: undefined,
    };
  }
}
