import { type TextChannel } from 'discord.js';
import PQueue from 'p-queue';
import type { Logger } from 'pino';
import { ClaudeRunner } from '../claude/runner.js';
import type { Config } from '../config/schema.js';
import type { SessionMeta } from './topicCodec.js';
import { encodeTopic, decodeTopic } from './topicCodec.js';
import type { UsageDelta, FinalResult, PermissionRequestEvent, PermissionDecision } from '../claude/types.js';
import { assertRealPathInsideRoot, isPathInsideRoot, resolveWithinRoot } from '../util/pathSecurity.js';

export interface ChannelSession {
  runner: ClaudeRunner | null;
  queue: PQueue;
  meta: SessionMeta;
  idleTimer: NodeJS.Timeout | null;
}

export interface SendCallbacks {
  onText: (delta: string) => void;
  onThinking?: (delta: string) => void;
  onToolUse: (block: { id: string; name: string; input: unknown }) => void;
  onToolResult?: (block: { toolUseId: string; content: string; isError?: boolean }) => void;
  onUsage: (u: UsageDelta) => void;
  onRateLimit?: (info: unknown) => void;
  onError: (err: Error) => void;
  onEnd: (result: FinalResult) => void;
  onPermission?: (req: PermissionRequestEvent) => Promise<PermissionDecision>;
}

export interface SessionManagerDeps {
  config: Config;
  log: Logger;
}

/**
 * Build a system-prompt suffix that forces extended thinking (and final
 * responses) into the configured language, so the "thinking" block shown in
 * Discord is consistently localized across new sessions.
 */
function buildLanguageInstruction(lang: string): string | undefined {
  const normalized = lang.trim().toLowerCase();
  if (!normalized || normalized === 'en') return undefined;
  if (normalized === 'ko' || normalized.startsWith('ko-')) {
    return '항상 한국어로 사고(thinking)하고 한국어로 답변하라. 코드, 식별자, 명령어 등 원문 그대로 두어야 의미가 보존되는 부분은 예외다.';
  }
  return `Always think and respond in ${lang}. Keep code, identifiers, and commands in their original form when translation would distort meaning.`;
}

export class SessionManager {
  private readonly sessions = new Map<string, ChannelSession>();

  constructor(private readonly deps: SessionManagerDeps) {}

  /** Get the session for a channel, if one exists. */
  get(channelId: string): ChannelSession | undefined {
    return this.sessions.get(channelId);
  }

  /** Check if there's an active runner for a channel. */
  hasActiveRunner(channelId: string): boolean {
    const s = this.sessions.get(channelId);
    return s?.runner?.isRunning === true;
  }

  /**
   * Restore a session mapping from a channel's topic metadata.
   * Does NOT spawn a runner — that happens lazily on first message.
   */
  restoreFromTopic(channelId: string, topic: string | null | undefined): boolean {
    const meta = decodeTopic(topic);
    if (!meta) return false;
    if (!isPathInsideRoot(meta.cwd, this.deps.config.defaultCwd)) {
      this.deps.log.warn({ channelId, cwd: meta.cwd }, '허용된 작업 디렉토리 밖의 토픽 세션 복원 거부');
      return false;
    }
    if (this.sessions.has(channelId)) return true;
    this.sessions.set(channelId, {
      runner: null,
      queue: new PQueue({ concurrency: 1 }),
      meta,
      idleTimer: null,
    });
    this.deps.log.info({ channelId, sessionId: meta.sessionId }, '토픽에서 세션 복원');
    return true;
  }

  /**
   * Create a new session for a channel (no existing runner).
   * Spawns a runner immediately with the initial prompt.
   */
  async createSession(
    channelId: string,
    opts: { cwd?: string; model?: string; permissionMode?: string },
  ): Promise<ChannelSession> {
    const existing = this.sessions.get(channelId);
    if (existing?.runner?.isRunning) {
      throw new Error('이미 활성 세션이 있습니다. /cdb stop 후 재시도하세요.');
    }

    const meta: SessionMeta = {
      sessionId: '', // CLI가 발급한 ID를 init 이벤트에서 캡처
      cwd: resolveWithinRoot(opts.cwd, this.deps.config.defaultCwd),
      model: opts.model ?? this.deps.config.defaultModel,
      permissionMode: opts.permissionMode ?? this.deps.config.permissionMode,
      lastActiveAt: Date.now(),
    };

    const session: ChannelSession = {
      runner: null,
      queue: existing?.queue ?? new PQueue({ concurrency: 1 }),
      meta,
      idleTimer: null,
    };
    this.sessions.set(channelId, session);
    return session;
  }

  /**
   * Resume an existing session by ID.
   */
  async resumeSession(
    channelId: string,
    sessionId: string,
    opts?: { cwd?: string; model?: string; permissionMode?: string },
  ): Promise<ChannelSession> {
    const existing = this.sessions.get(channelId);
    if (existing?.runner?.isRunning) {
      await existing.runner.stop();
      this.clearIdleTimer(channelId);
    }

    const meta: SessionMeta = {
      sessionId,
      cwd: resolveWithinRoot(opts?.cwd ?? existing?.meta.cwd, this.deps.config.defaultCwd),
      model: opts?.model ?? existing?.meta.model ?? this.deps.config.defaultModel,
      permissionMode: opts?.permissionMode ?? existing?.meta.permissionMode ?? this.deps.config.permissionMode,
      lastActiveAt: Date.now(),
    };

    const session: ChannelSession = {
      runner: null,
      queue: existing?.queue ?? new PQueue({ concurrency: 1 }),
      meta,
      idleTimer: null,
    };
    this.sessions.set(channelId, session);
    return session;
  }

  /**
   * Send a prompt to the channel's session. Spawns a runner if needed.
   * Returns event listeners for the caller to wire up UI.
   */
  async send(
    channelId: string,
    prompt: string,
    callbacks: SendCallbacks,
  ): Promise<void> {
    let session = this.sessions.get(channelId);
    if (!session) {
      session = await this.createSession(channelId, {});
    }

    await session.queue.add(async () => {
      this.clearIdleTimer(channelId);
      session!.meta.lastActiveAt = Date.now();

      if (!session!.runner || !session!.runner.isRunning) {
        session!.runner = this.spawnRunner(session!.meta, prompt);
        this.wireRunnerEvents(channelId, session!.runner, callbacks);
        await session!.runner.start();
      } else {
        // Runner already running — just send the prompt
        await session!.runner.send(prompt);
        return;
      }
    });
  }

  /**
   * Stop the runner for a channel.
   */
  async stop(channelId: string): Promise<boolean> {
    const session = this.sessions.get(channelId);
    if (!session?.runner?.isRunning) return false;
    await session.runner.stop();
    this.clearIdleTimer(channelId);
    return true;
  }

  async close(channelId: string): Promise<boolean> {
    const session = this.sessions.get(channelId);
    if (!session) return false;
    if (session.runner?.isRunning) {
      await session.runner.stop();
    }
    this.clearIdleTimer(channelId);
    this.sessions.delete(channelId);
    return true;
  }

  /**
   * Change the model for a channel. Takes effect on next runner spawn.
   */
  setModel(channelId: string, model: string): boolean {
    const session = this.sessions.get(channelId);
    if (!session) return false;
    session.meta.model = model;
    return true;
  }

  /**
   * Update channel topic with current session metadata.
   */
  async syncTopic(channel: TextChannel): Promise<void> {
    const session = this.sessions.get(channel.id);
    if (!session) return;
    const newTopic = encodeTopic(session.meta, channel.topic ?? undefined);
    if (channel.topic !== newTopic) {
      await channel.setTopic(newTopic).catch((err) => {
        this.deps.log.warn({ err, channelId: channel.id }, '채널 토픽 업데이트 실패');
      });
    }
  }

  /**
   * Shutdown all sessions (for graceful bot shutdown).
   */
  async shutdownAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [channelId, session] of this.sessions) {
      this.clearIdleTimer(channelId);
      if (session.runner?.isRunning) {
        promises.push(session.runner.stop());
      }
    }
    await Promise.allSettled(promises);
    this.sessions.clear();
  }

  private spawnRunner(meta: SessionMeta, initialPrompt?: string): ClaudeRunner {
    assertRealPathInsideRoot(meta.cwd, this.deps.config.defaultCwd);
    const opts = {
      bin: this.deps.config.claudeBin,
      cwd: meta.cwd,
      model: meta.model,
      permissionMode: meta.permissionMode ?? this.deps.config.permissionMode,
      includePartialMessages: true,
      resumeSessionId: meta.sessionId || undefined,
      initialPrompt,
      appendSystemPrompt: buildLanguageInstruction(this.deps.config.defaultLang),
    };
    return new ClaudeRunner(opts);
  }

  private wireRunnerEvents(
    channelId: string,
    runner: ClaudeRunner,
    callbacks: SendCallbacks,
  ): void {
    runner.on('init', (sys) => {
      const session = this.sessions.get(channelId);
      if (session && sys.session_id) {
        session.meta.sessionId = sys.session_id;
        if (sys.cwd) session.meta.cwd = sys.cwd;
        if (sys.model) session.meta.model = sys.model;
      }
    });
    runner.on('text', callbacks.onText);
    if (callbacks.onThinking) runner.on('thinking', callbacks.onThinking);
    runner.on('toolUse', callbacks.onToolUse);
    if (callbacks.onToolResult) runner.on('toolResult', callbacks.onToolResult);
    runner.on('usage', callbacks.onUsage);
    if (callbacks.onRateLimit) runner.on('rateLimit', callbacks.onRateLimit);
    runner.on('error', callbacks.onError);
    if (callbacks.onPermission) {
      runner.on('permission', (req) => {
        void callbacks.onPermission!(req).then((decision) => {
          if (runner.isRunning) {
            runner.sendPermission(decision);
          }
        }).catch((err) => {
          this.deps.log.error({ err }, '권한 프롬프트 처리 실패');
          runner.sendPermission({ type: 'permission_decision', id: req.id, decision: 'deny' });
        });
      });
    }
    runner.on('end', (result) => {
      runner.endInput();
      callbacks.onEnd(result);
      this.startIdleTimer(channelId);
    });
    runner.on('exit', () => {
      const session = this.sessions.get(channelId);
      if (session) session.runner = null;
    });
  }

  private startIdleTimer(channelId: string): void {
    this.clearIdleTimer(channelId);
    const session = this.sessions.get(channelId);
    if (!session) return;
    session.idleTimer = setTimeout(() => {
      this.deps.log.info({ channelId }, 'idle 타임아웃, runner 종료');
      if (session.runner?.isRunning) {
        void session.runner.stop();
      }
    }, this.deps.config.idleTimeoutMs);
  }

  private clearIdleTimer(channelId: string): void {
    const session = this.sessions.get(channelId);
    if (session?.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
  }
}
