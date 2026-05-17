import { EventEmitter } from 'node:events';
import {
  query,
  type CanUseTool,
  type PermissionMode,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  FinalResult,
  PermissionDecision,
  PermissionRequestEvent,
  ResultEvent,
  RunnerStartOptions,
  StreamEvent,
  SystemInitEvent,
  UsageDelta,
} from './types.js';

export interface RunnerEvents {
  init: (e: SystemInitEvent) => void;
  text: (delta: string) => void;
  toolUse: (block: { id: string; name: string; input: unknown }) => void;
  toolResult: (block: { toolUseId: string; content: string; isError?: boolean }) => void;
  thinking: (delta: string) => void;
  permission: (req: PermissionRequestEvent) => void;
  usage: (u: UsageDelta) => void;
  rateLimit: (info: unknown) => void;
  raw: (e: StreamEvent) => void;
  end: (final: FinalResult) => void;
  error: (err: Error) => void;
  exit: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export interface ClaudeRunner {
  on<K extends keyof RunnerEvents>(event: K, cb: RunnerEvents[K]): this;
  off<K extends keyof RunnerEvents>(event: K, cb: RunnerEvents[K]): this;
  once<K extends keyof RunnerEvents>(event: K, cb: RunnerEvents[K]): this;
}

type MessageStreamItem = SDKUserMessage | { __end: true };

const SDK_PERMISSION_MODES = new Set<PermissionMode>([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
  'auto',
]);

function mapPermissionMode(mode: string | undefined): PermissionMode | undefined {
  if (!mode) return undefined;
  if (SDK_PERMISSION_MODES.has(mode as PermissionMode)) return mode as PermissionMode;
  return 'default';
}

export class ClaudeRunner extends EventEmitter {
  private q: Query | null = null;
  private abortController: AbortController = new AbortController();
  private resolveNext: ((msg: MessageStreamItem) => void) | null = null;
  private pendingPermissions = new Map<string, (decision: PermissionResult) => void>();
  private sessionId: string | null = null;
  private model: string | null = null;
  private cwdSnapshot: string | null = null;
  private started = false;
  private finished = false;
  private emittedPartialDeltas = false;

  constructor(private readonly opts: RunnerStartOptions) {
    super();
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }
  get currentModel(): string | null {
    return this.model;
  }
  get currentCwd(): string | null {
    return this.cwdSnapshot;
  }
  get isRunning(): boolean {
    return this.started && !this.finished;
  }

  async start(): Promise<void> {
    if (this.started) throw new Error('runner already started');
    this.started = true;

    const canUseTool: CanUseTool = (toolName, input, info) => {
      return new Promise<PermissionResult>((resolve) => {
        const toolUseID = info.toolUseID;
        this.pendingPermissions.set(toolUseID, resolve);
        const req: PermissionRequestEvent = {
          type: 'permission_request',
          id: toolUseID,
          tool: { name: toolName, input },
          risk: info.decisionReason,
          session_id: this.sessionId ?? '',
        };
        this.emit('permission', req);
      });
    };

    this.q = query({
      prompt: this.messageStream(),
      options: {
        cwd: this.opts.cwd,
        model: this.opts.model,
        permissionMode: mapPermissionMode(this.opts.permissionMode),
        includePartialMessages: this.opts.includePartialMessages !== false,
        ...(this.opts.resumeSessionId ? { resume: this.opts.resumeSessionId } : {}),
        ...(this.opts.appendSystemPrompt
          ? {
              systemPrompt: {
                type: 'preset' as const,
                preset: 'claude_code' as const,
                append: this.opts.appendSystemPrompt,
              },
            }
          : {}),
        abortController: this.abortController,
        canUseTool,
        env: buildSafeEnv(),
      },
    });

    if (this.opts.initialPrompt && this.opts.initialPrompt.length > 0) {
      await this.send(this.opts.initialPrompt);
    }

    void this.processEvents();
  }

  async send(prompt: string): Promise<void> {
    if (!this.started) throw new Error('runner not started');
    if (this.finished) throw new Error('runner finished');
    const msg: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: prompt },
      parent_tool_use_id: null,
    };
    await this.pushToStream(msg);
  }

  sendPermission(decision: PermissionDecision): void {
    const resolver = this.pendingPermissions.get(decision.id);
    if (!resolver) return;
    this.pendingPermissions.delete(decision.id);
    if (decision.decision === 'deny') {
      resolver({ behavior: 'deny', message: 'User denied permission via Discord' });
      return;
    }
    const input = (decision.modifiedInput as Record<string, unknown> | undefined) ?? {};
    resolver({ behavior: 'allow', updatedInput: input });
  }

  /** End the message stream so the query terminates after the current turn. */
  endInput(): void {
    if (!this.started || this.finished) return;
    this.finished = true;
    void this.pushToStream({ __end: true });
    this.abortController.abort();
  }

  async stop(_signal: NodeJS.Signals = 'SIGINT'): Promise<void> {
    if (!this.started) return;
    if (this.finished) return;
    this.finished = true;
    this.abortController.abort();
    if (this.q) {
      try {
        await this.q.return();
      } catch {
        // ignore
      }
    }
    // Drain any pending permissions as denials
    for (const resolve of this.pendingPermissions.values()) {
      resolve({ behavior: 'deny', message: 'Session stopped' });
    }
    this.pendingPermissions.clear();
    if (this.resolveNext) {
      const r = this.resolveNext;
      this.resolveNext = null;
      r({ __end: true });
    }
  }

  private async pushToStream(item: MessageStreamItem): Promise<void> {
    // Wait until the generator is ready to receive the next message
    while (!this.resolveNext) {
      if (this.finished && !(item as { __end?: boolean }).__end) {
        throw new Error('runner finished before message could be sent');
      }
      await new Promise<void>((r) => setTimeout(r, 5));
    }
    const r = this.resolveNext;
    this.resolveNext = null;
    r(item);
  }

  private async *messageStream(): AsyncGenerator<SDKUserMessage> {
    while (true) {
      const item = await new Promise<MessageStreamItem>((resolve) => {
        this.resolveNext = resolve;
      });
      if ((item as { __end?: boolean }).__end) return;
      yield item as SDKUserMessage;
    }
  }

  private async processEvents(): Promise<void> {
    if (!this.q) return;
    try {
      for await (const msg of this.q) {
        this.emit('raw', msg as unknown as StreamEvent);
        this.handleMessage(msg);
      }
    } catch (err) {
      if (!isAbortError(err)) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this.finished = true;
      this.emit('exit', 0, null);
    }
  }

  private handleMessage(msg: SDKMessage): void {
    switch (msg.type) {
      case 'system': {
        if ((msg as { subtype?: string }).subtype === 'init') {
          const sys = msg as {
            session_id: string;
            cwd: string;
            model: string;
            tools: string[];
            permissionMode: string;
            claude_code_version: string;
          };
          this.sessionId = sys.session_id;
          this.model = sys.model;
          this.cwdSnapshot = sys.cwd;
          const init: SystemInitEvent = {
            type: 'system',
            subtype: 'init',
            session_id: sys.session_id,
            cwd: sys.cwd,
            model: sys.model,
            tools: sys.tools,
            permissionMode: sys.permissionMode,
            claude_code_version: sys.claude_code_version,
          };
          this.emit('init', init);
        }
        return;
      }
      case 'assistant': {
        const a = msg as unknown as {
          message: {
            content?: Array<Record<string, unknown>>;
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              cache_creation_input_tokens?: number;
              cache_read_input_tokens?: number;
            };
          };
        };
        const content = a.message.content ?? [];
        for (const block of content) {
          const type = block.type;
          if (!this.emittedPartialDeltas && type === 'text' && typeof block.text === 'string') {
            this.emit('text', block.text);
          } else if (
            !this.emittedPartialDeltas &&
            type === 'thinking' &&
            typeof block.thinking === 'string'
          ) {
            this.emit('thinking', block.thinking);
          } else if (type === 'tool_use') {
            this.emit('toolUse', {
              id: String(block.id),
              name: String(block.name),
              input: block.input,
            });
          }
        }
        if (a.message.usage) {
          this.emit('usage', mapUsage(a.message.usage));
        }
        return;
      }
      case 'user': {
        const u = msg as { message: { content?: unknown } };
        const content = u.message.content;
        if (!Array.isArray(content)) return;
        for (const block of content) {
          if (!block || typeof block !== 'object') continue;
          const b = block as Record<string, unknown>;
          if (b.type !== 'tool_result') continue;
          const toolUseId = b.tool_use_id;
          if (typeof toolUseId !== 'string') continue;
          const raw = b.content;
          const isError = Boolean(b.is_error);
          const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
          this.emit('toolResult', { toolUseId, content: text, isError });
        }
        return;
      }
      case 'stream_event': {
        const ev = (msg as { event?: { delta?: Record<string, unknown> } }).event;
        const delta = ev?.delta;
        if (!delta) return;
        if (typeof delta.text === 'string' && delta.text.length > 0) {
          this.emittedPartialDeltas = true;
          this.emit('text', delta.text);
        }
        if (typeof delta.thinking === 'string' && delta.thinking.length > 0) {
          this.emittedPartialDeltas = true;
          this.emit('thinking', delta.thinking);
        }
        return;
      }
      case 'result': {
        const r = msg as unknown as {
          subtype: 'success' | string;
          is_error: boolean;
          duration_ms: number;
          duration_api_ms?: number;
          num_turns: number;
          result?: string;
          session_id: string;
          total_cost_usd?: number;
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
          };
        };
        if (r.usage) {
          this.emit('usage', mapUsage(r.usage, r.total_cost_usd, true));
        }
        const final: ResultEvent = {
          type: 'result',
          subtype: r.subtype,
          is_error: r.is_error,
          duration_ms: r.duration_ms,
          duration_api_ms: r.duration_api_ms,
          num_turns: r.num_turns,
          result: r.result,
          session_id: r.session_id,
          total_cost_usd: r.total_cost_usd,
          usage: r.usage,
        };
        this.emit('end', final);
        return;
      }
      default: {
        const anyMsg = msg as { type?: string; rate_limit_info?: unknown };
        if (anyMsg.type === 'rate_limit_event' && anyMsg.rate_limit_info) {
          this.emit('rateLimit', anyMsg.rate_limit_info);
        }
        return;
      }
    }
  }
}

function buildSafeEnv(): Record<string, string | undefined> {
  const { DISCORD_TOKEN, DISCORD_CLIENT_ID, ALLOWED_USER_IDS, ...safeEnv } = process.env;
  return safeEnv;
}

function mapUsage(
  u: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  },
  costUsd?: number,
  final = false,
): UsageDelta {
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    costUsd,
    final,
  };
}

function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
    return true;
  }
  return false;
}

/**
 * Kept for compatibility with tests/imports. The SDK-based runner no longer
 * spawns the claude CLI as a child process, so these helpers are advisory only.
 */
export function buildClaudeArgs(
  opts: Pick<RunnerStartOptions, 'model' | 'permissionMode' | 'resumeSessionId' | 'extraArgs' | 'includePartialMessages'>,
): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose'];
  if (opts.includePartialMessages !== false) args.push('--include-partial-messages');
  if (opts.model) args.push('--model', opts.model);
  if (opts.permissionMode) args.push('--permission-mode', opts.permissionMode);
  if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
  if (opts.extraArgs) args.push(...opts.extraArgs);
  return args;
}

export function buildClaudeSpawnOptions(opts: Pick<RunnerStartOptions, 'cwd'>): {
  cwd: string;
  env: Record<string, string | undefined>;
} {
  return { cwd: opts.cwd, env: buildSafeEnv() };
}
