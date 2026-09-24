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
  AskUserQuestionAnswer,
  AskUserQuestionEvent,
  AskUserQuestionItem,
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
  askUserQuestion: (req: AskUserQuestionEvent) => void;
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
  private pendingQuestions = new Map<string, (decision: PermissionResult) => void>();
  private sessionId: string | null = null;
  private model: string | null = null;
  private cwdSnapshot: string | null = null;
  private started = false;
  private finished = false;
  /** A turn is in flight: set by send(), cleared on the turn's result. */
  private busy = false;
  /** `total_cost_usd` is cumulative over the process lifetime; kept to derive per-turn cost. */
  private cumulativeCostUsd = 0;
  private emittedPartialDeltas = false;
  private partialTextAccum = '';
  private partialThinkingAccum = '';

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
  /** The Claude Code process is up and can take another turn without a resume. */
  get isAlive(): boolean {
    return this.started && !this.finished;
  }
  /** A turn is in flight. */
  get isBusy(): boolean {
    return this.isAlive && this.busy;
  }

  async start(): Promise<void> {
    if (this.started) throw new Error('runner already started');
    this.started = true;

    const resolvedPermissionMode = mapPermissionMode(this.opts.permissionMode);

    // SDK가 canUseTool을 호출하는 시점은 이미 classifier(auto)/규칙이 판단을
    // 위임한 상태다. CLI는 auto/acceptEdits 모드에서 이 콜백을 자체적으로
    // 통과시키므로 프롬프트가 뜨지 않는다. 봇도 동일 UX를 내려면 여기서
    // 그대로 allow를 반환해야 한다 — Discord로 요청을 던지면 CLI에는 없는
    // 프롬프트가 사용자에게 계속 튀는 회귀가 된다.
    const autoAllowMode =
      resolvedPermissionMode === 'auto' || resolvedPermissionMode === 'acceptEdits';

    const canUseTool: CanUseTool = (toolName, input, info) => {
      return new Promise<PermissionResult>((resolve) => {
        const toolUseID = info.toolUseID;
        if (toolName === 'AskUserQuestion') {
          this.pendingQuestions.set(toolUseID, resolve);
          const questions = extractQuestions(input);
          const req: AskUserQuestionEvent = {
            type: 'ask_user_question',
            id: toolUseID,
            questions,
            session_id: this.sessionId ?? '',
          };
          this.emit('askUserQuestion', req);
          return;
        }
        if (autoAllowMode) {
          resolve({ behavior: 'allow', updatedInput: input });
          return;
        }
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
        permissionMode: resolvedPermissionMode,
        ...(resolvedPermissionMode === 'bypassPermissions'
          ? { allowDangerouslySkipPermissions: true }
          : {}),
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
    this.busy = true;
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

  /**
   * Deliver the user's answer to an `AskUserQuestion` tool call.
   * We respond via `behavior: 'deny'` because the SDK has no API for the
   * host to inject a tool result directly; the `message` field is passed
   * through to the model as the tool_result body, where we encode the
   * standard AskUserQuestionOutput JSON so the model recognises it as a
   * normal answer rather than a denial.
   */
  sendQuestionAnswer(answer: AskUserQuestionAnswer): void {
    const resolver = this.pendingQuestions.get(answer.id);
    if (!resolver) return;
    this.pendingQuestions.delete(answer.id);
    const payload = JSON.stringify({ answers: answer.answers, interrupted: answer.interrupted });
    resolver({ behavior: 'deny', message: payload });
  }

  /** End the message stream so the query terminates after the current turn. */
  endInput(): void {
    if (!this.started || this.finished) return;
    this.finished = true;
    void this.pushToStream({ __end: true });
    this.abortController.abort();
  }

  /**
   * Abort the in-flight turn but keep the process (and its prompt cache
   * prefix) alive. The SDK still emits a `result` for the interrupted turn,
   * so `end` fires as usual.
   */
  async interrupt(): Promise<boolean> {
    if (!this.isBusy || !this.q) return false;
    this.drainPending('Interrupted by user');
    try {
      await this.q.interrupt();
    } catch {
      // ignore — the turn may have ended in the meantime
    }
    return true;
  }

  /** Switch model in the live process; takes effect on the next API call. */
  async setModel(model: string): Promise<void> {
    if (!this.isAlive || !this.q) return;
    await this.q.setModel(model);
  }

  /** Terminate the process. */
  async close(): Promise<void> {
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
    this.drainPending('Session stopped');
    if (this.resolveNext) {
      const r = this.resolveNext;
      this.resolveNext = null;
      r({ __end: true });
    }
  }

  private drainPending(reason: string): void {
    for (const resolve of this.pendingPermissions.values()) {
      resolve({ behavior: 'deny', message: reason });
    }
    this.pendingPermissions.clear();
    for (const resolve of this.pendingQuestions.values()) {
      resolve({
        behavior: 'deny',
        message: JSON.stringify({ answers: {}, interrupted: true }),
      });
    }
    this.pendingQuestions.clear();
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
        const fullText = content
          .filter((b) => b.type === 'text' && typeof b.text === 'string')
          .map((b) => b.text as string)
          .join('');
        const fullThinking = content
          .filter((b) => b.type === 'thinking' && typeof b.thinking === 'string')
          .map((b) => b.thinking as string)
          .join('');

        if (this.emittedPartialDeltas) {
          if (fullText.length > this.partialTextAccum.length) {
            this.emit('text', fullText.slice(this.partialTextAccum.length));
          }
          if (fullThinking.length > this.partialThinkingAccum.length) {
            this.emit('thinking', fullThinking.slice(this.partialThinkingAccum.length));
          }
        } else {
          if (fullText.length > 0) this.emit('text', fullText);
          if (fullThinking.length > 0) this.emit('thinking', fullThinking);
        }

        for (const block of content) {
          if (block.type === 'tool_use') {
            this.emit('toolUse', {
              id: String(block.id),
              name: String(block.name),
              input: block.input,
            });
          }
        }

        this.partialTextAccum = '';
        this.partialThinkingAccum = '';
        this.emittedPartialDeltas = false;

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
          this.partialTextAccum += delta.text;
          this.emit('text', delta.text);
        }
        if (typeof delta.thinking === 'string' && delta.thinking.length > 0) {
          this.emittedPartialDeltas = true;
          this.partialThinkingAccum += delta.thinking;
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
        // 프로세스가 여러 턴을 처리하므로 total_cost_usd는 누적값이다. 턴 비용으로 환산한다.
        let turnCostUsd: number | undefined;
        if (typeof r.total_cost_usd === 'number') {
          turnCostUsd = Math.max(0, r.total_cost_usd - this.cumulativeCostUsd);
          this.cumulativeCostUsd = r.total_cost_usd;
        }
        // 중단된 턴은 result usage가 전부 0으로 온다. 그대로 final로 내보내면 이미
        // 스트리밍으로 집계한 토큰을 0으로 덮어쓰므로 건너뛴다.
        if (r.usage && !isEmptyUsage(r.usage)) {
          this.emit('usage', mapUsage(r.usage, turnCostUsd, true));
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
          total_cost_usd: turnCostUsd,
          usage: r.usage,
        };
        this.busy = false;
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

function isEmptyUsage(u: {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}): boolean {
  return !u.input_tokens && !u.output_tokens && !u.cache_creation_input_tokens && !u.cache_read_input_tokens;
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

function extractQuestions(input: unknown): AskUserQuestionItem[] {
  if (!input || typeof input !== 'object') return [];
  const raw = (input as { questions?: unknown }).questions;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q): AskUserQuestionItem | null => {
      if (!q || typeof q !== 'object') return null;
      const obj = q as Record<string, unknown>;
      const question = typeof obj.question === 'string' ? obj.question : '';
      const header = typeof obj.header === 'string' ? obj.header : '';
      const options: AskUserQuestionItem['options'] = Array.isArray(obj.options)
        ? obj.options.flatMap((opt): AskUserQuestionItem['options'] => {
            if (!opt || typeof opt !== 'object') return [];
            const o = opt as Record<string, unknown>;
            const label = typeof o.label === 'string' ? o.label : '';
            if (!label) return [];
            const description = typeof o.description === 'string' ? o.description : '';
            const item: AskUserQuestionItem['options'][number] = { label, description };
            if (typeof o.preview === 'string') item.preview = o.preview;
            return [item];
          })
        : [];
      const multiSelect = Boolean(obj.multiSelect);
      if (!question || options.length === 0) return null;
      return { question, header, options, multiSelect };
    })
    .filter((q): q is AskUserQuestionItem => q !== null);
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
