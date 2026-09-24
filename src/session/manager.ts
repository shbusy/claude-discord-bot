import { type TextChannel } from 'discord.js';
import PQueue from 'p-queue';
import type { Logger } from 'pino';
import { ClaudeRunner } from '../claude/runner.js';
import type { Config } from '../config/schema.js';
import type { SessionMeta } from './topicCodec.js';
import { encodeTopic, decodeTopic } from './topicCodec.js';
import type {
  UsageDelta,
  FinalResult,
  PermissionRequestEvent,
  PermissionDecision,
  AskUserQuestionEvent,
  AskUserQuestionAnswer,
} from '../claude/types.js';
import { assertRealPathInsideRoot, isPathInsideRoot, resolveWithinRoot } from '../util/pathSecurity.js';

export interface ChannelSession {
  runner: ClaudeRunner | null;
  queue: PQueue;
  meta: SessionMeta;
  idleTimer: NodeJS.Timeout | null;
  /**
   * Callbacks of the turn in flight. The runner outlives a single turn, so its
   * events are routed through here instead of being bound to the first caller.
   */
  activeTurn: ActiveTurn | null;
}

interface ActiveTurn {
  callbacks: SendCallbacks;
  done: () => void;
}

/** How a turn reached the model — used to tell cache misses we caused from ones we didn't. */
export interface TurnStartInfo {
  /** A new Claude Code process was spawned (resume) for this turn. */
  spawned: boolean;
  /** Time since the previous turn in this channel ended, if any. */
  idleMs: number | null;
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
  onAskUserQuestion?: (req: AskUserQuestionEvent) => Promise<AskUserQuestionAnswer>;
  onTurnStart?: (info: TurnStartInfo) => void;
}

export interface SessionManagerDeps {
  config: Config;
  log: Logger;
}

function isOff(lang: string): boolean {
  const normalized = lang.trim().toLowerCase();
  return !normalized || normalized === 'off' || normalized === 'none';
}

function isKorean(lang: string): boolean {
  const normalized = lang.trim().toLowerCase();
  return normalized === 'ko' || normalized.startsWith('ko-');
}

/**
 * Build a system-prompt suffix that pins the response language, and — only
 * when explicitly configured — the extended-thinking language too. Forcing
 * thinking into Korean inflates output tokens (the priciest kind), so it is
 * off by default.
 */
export function buildLanguageInstruction(lang: string, thinkingLang = 'off'): string | undefined {
  const parts: string[] = [];
  const respond = lang.trim().toLowerCase();
  if (!isOff(lang) && respond !== 'en') {
    parts.push(
      isKorean(lang)
        ? '항상 한국어로 답변하라. 코드, 식별자, 명령어 등 원문 그대로 두어야 의미가 보존되는 부분은 예외다.'
        : `Always respond in ${lang}. Keep code, identifiers, and commands in their original form when translation would distort meaning.`,
    );
  }
  if (!isOff(thinkingLang)) {
    parts.push(
      isKorean(thinkingLang)
        ? '사고(thinking)도 한국어로 하라.'
        : `Also think in ${thinkingLang}.`,
    );
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

export class SessionManager {
  private readonly sessions = new Map<string, ChannelSession>();

  constructor(private readonly deps: SessionManagerDeps) {}

  /** Get the session for a channel, if one exists. */
  get(channelId: string): ChannelSession | undefined {
    return this.sessions.get(channelId);
  }

  /** Check if a turn is in flight for a channel. */
  hasActiveRunner(channelId: string): boolean {
    const s = this.sessions.get(channelId);
    return s?.runner?.isBusy === true || s?.activeTurn != null;
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
      activeTurn: null,
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
    if (existing?.runner?.isBusy) {
      throw new Error('이미 활성 세션이 있습니다. /cdb stop 후 재시도하세요.');
    }
    // 새 세션은 새 프로세스로 시작한다. 살아 있는 이전 프로세스는 정리.
    if (existing?.runner?.isAlive) {
      await existing.runner.close();
    }
    if (existing) this.clearIdleTimer(channelId);

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
      activeTurn: null,
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
    if (existing?.runner?.isAlive) {
      await existing.runner.close();
    }
    if (existing) this.clearIdleTimer(channelId);

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
      activeTurn: null,
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

    const s = session;
    // 큐 작업은 턴이 끝날 때 완료된다. 동시에 들어온 메시지가 진행 중인 턴의
    // 콜백을 덮어쓰지 않도록 직렬화하는 역할이다.
    await s.queue.add(
      () =>
        new Promise<void>((resolve, reject) => {
          this.clearIdleTimer(channelId);
          const prevActiveAt = s.meta.lastActiveAt;
          s.meta.lastActiveAt = Date.now();
          s.activeTurn = { callbacks, done: resolve };

          const spawned = !s.runner?.isAlive;
          callbacks.onTurnStart?.({
            spawned,
            idleMs: s.meta.sessionId ? s.meta.lastActiveAt - prevActiveAt : null,
          });

          const run = async (): Promise<void> => {
            if (spawned) {
              // 프로세스를 턴마다 새로 띄우면 resume 시 재조립된 대화가 직전
              // 요청과 바이트 단위로 달라져 프롬프트 캐시가 통째로 빗나간다.
              // 한 번 띄운 프로세스를 idle 타임아웃까지 유지해 CLI와 같은 캐시 적중을 얻는다.
              const runner = this.spawnRunner(s.meta);
              s.runner = runner;
              this.wireRunnerEvents(channelId, runner);
              await runner.start();
            }
            await s.runner!.send(prompt);
          };
          run().catch((err: unknown) => {
            s.activeTurn = null;
            reject(err instanceof Error ? err : new Error(String(err)));
          });
        }),
    );
  }

  /**
   * Interrupt the in-flight turn. The process stays alive so the next message
   * continues the same conversation with a warm cache.
   */
  async stop(channelId: string): Promise<boolean> {
    const session = this.sessions.get(channelId);
    if (!session?.runner) return false;
    return session.runner.interrupt();
  }

  /**
   * Clear conversation context while keeping the channel and session settings.
   * Equivalent to Claude Code's /clear — next message starts fresh with no prior history.
   */
  async clearContext(channelId: string): Promise<boolean> {
    const session = this.sessions.get(channelId);
    if (!session) return false;
    await session.runner?.close();
    this.clearIdleTimer(channelId);
    session.runner = null;
    session.meta.sessionId = '';
    session.meta.lastActiveAt = Date.now();
    return true;
  }

  async close(channelId: string): Promise<boolean> {
    const session = this.sessions.get(channelId);
    if (!session) return false;
    await session.runner?.close();
    this.clearIdleTimer(channelId);
    this.sessions.delete(channelId);
    return true;
  }

  /**
   * Change the model for a channel. Applied to the live process right away,
   * otherwise on the next spawn.
   */
  setModel(channelId: string, model: string): boolean {
    const session = this.sessions.get(channelId);
    if (!session) return false;
    session.meta.model = model;
    if (session.runner?.isAlive) {
      void session.runner.setModel(model).catch((err) => {
        this.deps.log.warn({ err, channelId }, '실행 중 모델 변경 실패 — 다음 프로세스부터 적용');
      });
    }
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
      if (session.runner) {
        promises.push(session.runner.close());
      }
    }
    await Promise.allSettled(promises);
    this.sessions.clear();
  }

  private spawnRunner(meta: SessionMeta): ClaudeRunner {
    assertRealPathInsideRoot(meta.cwd, this.deps.config.defaultCwd);
    const opts = {
      bin: this.deps.config.claudeBin,
      cwd: meta.cwd,
      model: meta.model,
      permissionMode: meta.permissionMode ?? this.deps.config.permissionMode,
      includePartialMessages: true,
      resumeSessionId: meta.sessionId || undefined,
      appendSystemPrompt: buildLanguageInstruction(this.deps.config.defaultLang, this.deps.config.thinkingLang),
    };
    return new ClaudeRunner(opts);
  }

  private wireRunnerEvents(channelId: string, runner: ClaudeRunner): void {
    const turn = (): SendCallbacks | undefined => {
      const session = this.sessions.get(channelId);
      // 교체된 이전 러너의 늦은 이벤트가 새 턴에 섞이지 않도록 한다.
      if (!session || session.runner !== runner) return undefined;
      return session.activeTurn?.callbacks;
    };

    runner.on('init', (sys) => {
      const session = this.sessions.get(channelId);
      if (session && session.runner === runner && sys.session_id) {
        session.meta.sessionId = sys.session_id;
        if (sys.cwd) session.meta.cwd = sys.cwd;
        if (sys.model) session.meta.model = sys.model;
      }
    });
    runner.on('text', (d) => turn()?.onText(d));
    runner.on('thinking', (d) => turn()?.onThinking?.(d));
    runner.on('toolUse', (b) => turn()?.onToolUse(b));
    runner.on('toolResult', (b) => turn()?.onToolResult?.(b));
    runner.on('usage', (u) => turn()?.onUsage(u));
    runner.on('rateLimit', (info) => turn()?.onRateLimit?.(info));
    runner.on('error', (err) => turn()?.onError(err));
    runner.on('permission', (req) => {
      const onPermission = turn()?.onPermission;
      if (!onPermission) {
        runner.sendPermission({ type: 'permission_decision', id: req.id, decision: 'deny' });
        return;
      }
      void onPermission(req).then((decision) => {
        if (runner.isAlive) {
          runner.sendPermission(decision);
        }
      }).catch((err) => {
        this.deps.log.error({ err }, '권한 프롬프트 처리 실패');
        runner.sendPermission({ type: 'permission_decision', id: req.id, decision: 'deny' });
      });
    });
    runner.on('askUserQuestion', (req) => {
      const onAsk = turn()?.onAskUserQuestion;
      const interrupted: AskUserQuestionAnswer = {
        type: 'ask_user_question_answer',
        id: req.id,
        answers: {},
        interrupted: true,
      };
      if (!onAsk) {
        runner.sendQuestionAnswer(interrupted);
        return;
      }
      void onAsk(req).then((answer) => {
        if (runner.isAlive) {
          runner.sendQuestionAnswer(answer);
        }
      }).catch((err) => {
        this.deps.log.error({ err }, 'AskUserQuestion 처리 실패');
        runner.sendQuestionAnswer(interrupted);
      });
    });
    runner.on('end', (result) => {
      const session = this.sessions.get(channelId);
      if (!session || session.runner !== runner) return;
      this.finishTurn(session, (cb) => cb.onEnd(result));
      this.startIdleTimer(channelId);
    });
    runner.on('exit', () => {
      const session = this.sessions.get(channelId);
      if (!session || session.runner !== runner) return;
      session.runner = null;
      // 턴 도중 프로세스가 죽으면 result가 오지 않는다. UI가 멈춰 있지 않도록 턴을 닫는다.
      this.finishTurn(session, (cb) => {
        cb.onError(new Error('Claude 프로세스가 응답 도중 종료되었습니다.'));
        cb.onEnd({
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          duration_ms: 0,
          num_turns: 0,
          session_id: session.meta.sessionId,
        });
      });
      this.clearIdleTimer(channelId);
    });
  }

  private finishTurn(session: ChannelSession, notify: (cb: SendCallbacks) => void): void {
    const active = session.activeTurn;
    if (!active) return;
    session.activeTurn = null;
    session.meta.lastActiveAt = Date.now();
    try {
      notify(active.callbacks);
    } finally {
      active.done();
    }
  }

  private startIdleTimer(channelId: string): void {
    this.clearIdleTimer(channelId);
    const session = this.sessions.get(channelId);
    if (!session) return;
    session.idleTimer = setTimeout(() => {
      this.deps.log.info({ channelId }, 'idle 타임아웃, runner 종료');
      if (session.runner && !session.runner.isBusy) {
        const runner = session.runner;
        session.runner = null;
        void runner.close();
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
