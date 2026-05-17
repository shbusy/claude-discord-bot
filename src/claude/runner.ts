import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { StreamParser } from './streamParser.js';
import type {
  AssistantEvent,
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

export function buildClaudeSpawnOptions(opts: Pick<RunnerStartOptions, 'cwd'>): SpawnOptionsWithoutStdio {
  return {
    cwd: opts.cwd,
    env: process.env,
  };
}

export class ClaudeRunner extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private parser: StreamParser;
  private sessionId: string | null = null;
  private model: string | null = null;
  private cwdSnapshot: string | null = null;
  private finished = false;
  private stderrTail: string[] = [];
  private emittedPartialDeltas = false;

  constructor(private readonly opts: RunnerStartOptions) {
    super();
    this.parser = new StreamParser(
      (e) => this.handleEvent(e),
      (line, err) => this.emit('error', new Error(`malformed stream line: ${err.message} :: ${line.slice(0, 200)}`)),
    );
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
    return this.child !== null && !this.finished;
  }

  async start(): Promise<void> {
    if (this.child) throw new Error('runner already started');
    const args = this.buildArgs();
    const child = spawn(this.opts.bin, args, buildClaudeSpawnOptions(this.opts));
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => this.parser.feed(chunk));
    child.stderr.on('data', (chunk: string) => this.captureStderr(chunk));
    child.on('error', (err) => this.emit('error', err));
    child.on('close', (code, signal) => {
      this.parser.flush();
      this.finished = true;
      this.emit('exit', code, signal);
      if (code !== 0 && code !== null) {
        const tail = this.stderrTail.join('').slice(-2000);
        this.emit('error', new Error(`claude exited with code ${code}\n${tail}`));
      }
    });
    if (this.opts.initialPrompt && this.opts.initialPrompt.length > 0) {
      await this.send(this.opts.initialPrompt);
    }
  }

  async send(prompt: string): Promise<void> {
    if (!this.child) throw new Error('runner not started');
    if (this.child.stdin.writableEnded) throw new Error('stdin closed');
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: prompt },
    }) + '\n';
    this.child.stdin.write(line);
  }

  sendPermission(decision: PermissionDecision): void {
    if (!this.child) throw new Error('runner not started');
    if (this.child.stdin.writableEnded) throw new Error('stdin closed');
    this.child.stdin.write(JSON.stringify(decision) + '\n');
  }

  /** Close stdin so the CLI exits after the in-flight turn completes. */
  endInput(): void {
    if (!this.child) return;
    if (this.child.stdin.writableEnded) return;
    this.child.stdin.end();
  }

  async stop(signal: NodeJS.Signals = 'SIGINT'): Promise<void> {
    if (!this.child) return;
    if (!this.finished) {
      this.child.kill(signal);
      await new Promise<void>((resolve) => {
        if (!this.child) return resolve();
        this.child.once('close', () => resolve());
      });
    }
  }

  private buildArgs(): string[] {
    return buildClaudeArgs(this.opts);
  }

  private captureStderr(chunk: string): void {
    this.stderrTail.push(chunk);
    let total = this.stderrTail.reduce((n, s) => n + s.length, 0);
    while (total > 4000 && this.stderrTail.length > 1) {
      total -= this.stderrTail[0]!.length;
      this.stderrTail.shift();
    }
  }

  private handleEvent(e: StreamEvent): void {
    this.emit('raw', e);
    switch (e.type) {
      case 'system': {
        const sys = e as SystemInitEvent;
        if (sys.subtype === 'init') {
          this.sessionId = sys.session_id;
          this.model = sys.model;
          this.cwdSnapshot = sys.cwd;
          this.emit('init', sys);
        }
        return;
      }
      case 'assistant': {
        const a = e as AssistantEvent;
        for (const block of a.message.content ?? []) {
          if (!this.emittedPartialDeltas && block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
            this.emit('text', (block as { text: string }).text);
          } else if (!this.emittedPartialDeltas && block.type === 'thinking' && typeof (block as { thinking?: unknown }).thinking === 'string') {
            this.emit('thinking', (block as { thinking: string }).thinking);
          } else if (block.type === 'tool_use') {
            const tu = block as { id: string; name: string; input: unknown };
            this.emit('toolUse', { id: tu.id, name: tu.name, input: tu.input });
          }
        }
        if (a.message.usage) {
          this.emit('usage', mapUsage(a.message.usage));
        }
        return;
      }
      case 'user': {
        this.handleUserEvent(e);
        return;
      }
      case 'stream_event': {
        this.handleStreamEvent(e);
        return;
      }
      case 'rate_limit_event': {
        this.emit('rateLimit', (e as { rate_limit_info: unknown }).rate_limit_info);
        return;
      }
      case 'permission_request': {
        this.emit('permission', e as PermissionRequestEvent);
        return;
      }
      case 'result': {
        const r = e as ResultEvent;
        if (r.usage) this.emit('usage', mapUsage(r.usage, r.total_cost_usd, true));
        this.emit('end', r);
        return;
      }
      default:
        return;
    }
  }

  private handleStreamEvent(e: StreamEvent): void {
    const ev = (e as { event?: unknown }).event;
    if (!ev || typeof ev !== 'object') return;
    const delta = (ev as { delta?: unknown }).delta;
    if (!delta || typeof delta !== 'object') return;
    const text = (delta as { text?: unknown }).text;
    const thinking = (delta as { thinking?: unknown }).thinking;
    if (typeof text === 'string' && text.length > 0) {
      this.emittedPartialDeltas = true;
      this.emit('text', text);
    }
    if (typeof thinking === 'string' && thinking.length > 0) {
      this.emittedPartialDeltas = true;
      this.emit('thinking', thinking);
    }
  }

  private handleUserEvent(e: StreamEvent): void {
    const content = (e as { message?: { content?: unknown } }).message?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if ((block as { type?: unknown }).type !== 'tool_result') continue;
      const toolUseId = (block as { tool_use_id?: unknown }).tool_use_id;
      if (typeof toolUseId !== 'string') continue;
      const raw = (block as { content?: unknown }).content;
      const isError = Boolean((block as { is_error?: unknown }).is_error);
      const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
      this.emit('toolResult', { toolUseId, content: text, isError });
    }
  }
}

export function buildClaudeArgs(opts: Pick<
  RunnerStartOptions,
  'model' | 'permissionMode' | 'resumeSessionId' | 'extraArgs' | 'includePartialMessages'
>): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose'];
  if (opts.includePartialMessages !== false) args.push('--include-partial-messages');
  if (opts.model) args.push('--model', opts.model);
  if (opts.permissionMode) args.push('--permission-mode', opts.permissionMode);
  if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
  if (opts.extraArgs) args.push(...opts.extraArgs);
  return args;
}

function mapUsage(u: {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}, costUsd?: number, final = false): UsageDelta {
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheCreationInputTokens: u.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: u.cache_read_input_tokens ?? 0,
    costUsd,
    final,
  };
}
