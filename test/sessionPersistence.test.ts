import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config/schema.js';
import type { SendCallbacks } from '../src/session/manager.js';

class FakeRunner extends EventEmitter {
  static instances: FakeRunner[] = [];
  alive = false;
  busy = false;
  sent: string[] = [];
  model: string | null = null;
  closed = false;

  constructor(readonly opts: { resumeSessionId?: string }) {
    super();
    FakeRunner.instances.push(this);
  }
  get isAlive(): boolean {
    return this.alive;
  }
  get isBusy(): boolean {
    return this.alive && this.busy;
  }
  async start(): Promise<void> {
    this.alive = true;
    this.emit('init', { session_id: 'sess-1', cwd: '', model: '' });
  }
  async send(prompt: string): Promise<void> {
    this.busy = true;
    this.sent.push(prompt);
  }
  async interrupt(): Promise<boolean> {
    if (!this.isBusy) return false;
    this.finishTurn('error_during_execution');
    return true;
  }
  async setModel(model: string): Promise<void> {
    this.model = model;
  }
  async close(): Promise<void> {
    this.alive = false;
    this.closed = true;
    this.emit('exit', 0, null);
  }
  finishTurn(subtype = 'success'): void {
    this.busy = false;
    this.emit('end', { type: 'result', subtype, is_error: false, duration_ms: 0, num_turns: 1, session_id: 'sess-1' });
  }
  crash(): void {
    this.alive = false;
    this.emit('exit', 1, null);
  }
}

vi.mock('../src/claude/runner.js', () => ({ ClaudeRunner: FakeRunner }));

const { SessionManager } = await import('../src/session/manager.js');

function makeConfig(): Config {
  return {
    discordToken: 't',
    discordClientId: 'c',
    discordGuildId: undefined,
    allowedUserIds: ['u'],
    claudeBin: 'claude',
    defaultModel: 'sonnet',
    permissionMode: 'default',
    defaultLang: 'ko',
    thinkingLang: 'off',
    defaultCwd: mkdtempSync(join(tmpdir(), 'cdb-sess-')),
    cdbHome: '/tmp/cdb',
    logLevel: 'info',
    idleTimeoutMs: 60_000,
  };
}

const log = { info: () => undefined, warn: () => undefined, error: () => undefined } as never;

function callbacks(): SendCallbacks & { texts: string[]; ended: number; starts: unknown[] } {
  const cb = {
    texts: [] as string[],
    ended: 0,
    starts: [] as unknown[],
    onText: (d: string) => cb.texts.push(d),
    onToolUse: () => undefined,
    onUsage: () => undefined,
    onError: () => undefined,
    onEnd: () => {
      cb.ended++;
    },
    onTurnStart: (info: unknown) => cb.starts.push(info),
  };
  return cb;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  FakeRunner.instances = [];
  vi.useRealTimers();
});

describe('SessionManager persistent runner', () => {
  it('reuses one process across turns and routes events to the current turn', async () => {
    const sessions = new SessionManager({ config: makeConfig(), log });
    const first = callbacks();
    const p1 = sessions.send('ch', 'one', first);
    await tick();
    const runner = FakeRunner.instances[0]!;
    runner.emit('text', 'a');
    runner.finishTurn();
    await p1;

    expect(runner.isAlive).toBe(true);
    expect(sessions.hasActiveRunner('ch')).toBe(false);

    const second = callbacks();
    const p2 = sessions.send('ch', 'two', second);
    await tick();
    runner.emit('text', 'b');
    runner.finishTurn();
    await p2;

    expect(FakeRunner.instances).toHaveLength(1);
    expect(runner.sent).toEqual(['one', 'two']);
    expect(first.texts).toEqual(['a']);
    expect(second.texts).toEqual(['b']);
    expect(first.ended).toBe(1);
    expect(second.ended).toBe(1);
    expect(first.starts[0]).toMatchObject({ spawned: true, idleMs: null });
    expect(second.starts[0]).toMatchObject({ spawned: false });
  });

  it('stop interrupts the turn but keeps the process alive', async () => {
    const sessions = new SessionManager({ config: makeConfig(), log });
    const cb = callbacks();
    const p = sessions.send('ch', 'long', cb);
    await tick();
    expect(sessions.hasActiveRunner('ch')).toBe(true);

    await expect(sessions.stop('ch')).resolves.toBe(true);
    await p;

    const runner = FakeRunner.instances[0]!;
    expect(runner.isAlive).toBe(true);
    expect(cb.ended).toBe(1);
    await expect(sessions.stop('ch')).resolves.toBe(false);
  });

  it('closes the process after the idle timeout', async () => {
    vi.useFakeTimers();
    const sessions = new SessionManager({ config: makeConfig(), log });
    const p = sessions.send('ch', 'hi', callbacks());
    await vi.advanceTimersByTimeAsync(0);
    const runner = FakeRunner.instances[0]!;
    runner.finishTurn();
    await p;

    await vi.advanceTimersByTimeAsync(59_000);
    expect(runner.closed).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runner.closed).toBe(true);
    expect(sessions.get('ch')?.runner).toBeNull();

    // 다음 메시지는 저장된 세션 ID로 resume
    const p2 = sessions.send('ch', 'again', callbacks());
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeRunner.instances[1]!.opts.resumeSessionId).toBe('sess-1');
    FakeRunner.instances[1]!.finishTurn();
    await p2;
  });

  it('applies model changes to the live process', async () => {
    const sessions = new SessionManager({ config: makeConfig(), log });
    const p = sessions.send('ch', 'hi', callbacks());
    await tick();
    FakeRunner.instances[0]!.finishTurn();
    await p;

    sessions.setModel('ch', 'opus');
    await tick();
    expect(FakeRunner.instances[0]!.model).toBe('opus');
  });

  it('clear closes the process and starts a fresh session next time', async () => {
    const sessions = new SessionManager({ config: makeConfig(), log });
    const p = sessions.send('ch', 'hi', callbacks());
    await tick();
    FakeRunner.instances[0]!.finishTurn();
    await p;

    await sessions.clearContext('ch');
    expect(FakeRunner.instances[0]!.closed).toBe(true);

    const p2 = sessions.send('ch', 'fresh', callbacks());
    await tick();
    expect(FakeRunner.instances[1]!.opts.resumeSessionId).toBeUndefined();
    FakeRunner.instances[1]!.finishTurn();
    await p2;
  });

  it('ends the turn with an error when the process dies mid-turn', async () => {
    const sessions = new SessionManager({ config: makeConfig(), log });
    const cb = callbacks();
    const errors: string[] = [];
    cb.onError = (e) => {
      errors.push(e.message);
    };
    const p = sessions.send('ch', 'hi', cb);
    await tick();
    FakeRunner.instances[0]!.crash();
    await p;

    expect(cb.ended).toBe(1);
    expect(errors).toHaveLength(1);
    expect(sessions.get('ch')?.runner).toBeNull();
    expect(sessions.hasActiveRunner('ch')).toBe(false);
  });
});
