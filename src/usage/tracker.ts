import type { UsageDelta } from '../claude/types.js';
import type { TurnStartInfo } from '../session/manager.js';
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
  private firstCall: { creation: number; read: number } | null = null;
  private turnStart: TurnStartInfo | null = null;

  constructor(
    private readonly cdbHome: string,
    private readonly trackCtx: TrackingContext,
  ) {}

  /** Update the sessionId (e.g. after init event populates it). */
  updateSessionId(sessionId: string): void {
    this.trackCtx.sessionId = sessionId;
  }

  setTurnStart(info: TurnStartInfo): void {
    this.turnStart = info;
  }

  /** Accumulate a usage delta (called per assistant message). */
  record(delta: UsageDelta): void {
    if (!delta.final && !this.firstCall) {
      this.firstCall = {
        creation: delta.cacheCreationInputTokens ?? 0,
        read: delta.cacheReadInputTokens ?? 0,
      };
    }
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
        first_cache_creation_tokens: this.firstCall?.creation ?? null,
        first_cache_read_tokens: this.firstCall?.read ?? null,
        spawned: this.turnStart ? Number(this.turnStart.spawned) : null,
        idle_ms: this.turnStart?.idleMs ?? null,
      });
    } catch {
      // DB write failure — logged by caller, not critical
    }
    this.reset();
  }

  private reset(): void {
    this.firstCall = null;
    this.turnStart = null;
    this.accumulated = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      costUsd: undefined,
    };
  }
}
