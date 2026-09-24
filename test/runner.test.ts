import { describe, expect, it } from 'vitest';
import { ClaudeRunner, buildClaudeArgs, buildClaudeSpawnOptions } from '../src/claude/runner.js';

describe('ClaudeRunner', () => {
  it('builds CLI args required for Agent4Discord-style streaming sessions', () => {
    expect(buildClaudeArgs({
      model: 'opus',
      permissionMode: 'acceptEdits',
      resumeSessionId: 'session-123',
    })).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--model',
      'opus',
      '--permission-mode',
      'acceptEdits',
      '--resume',
      'session-123',
    ]);
  });

  it('passes sanitized env without DISCORD_TOKEN to child process', () => {
    process.env.DISCORD_TOKEN = 'secret-token';
    process.env.DISCORD_CLIENT_ID = 'client-id';
    process.env.ALLOWED_USER_IDS = '123';
    const opts = buildClaudeSpawnOptions({ cwd: '/work' });

    expect(opts.cwd).toBe('/work');
    expect(opts.env).not.toHaveProperty('DISCORD_TOKEN');
    expect(opts.env).not.toHaveProperty('DISCORD_CLIENT_ID');
    expect(opts.env).not.toHaveProperty('ALLOWED_USER_IDS');
    expect(opts.env).toHaveProperty('PATH');

    delete process.env.DISCORD_TOKEN;
    delete process.env.DISCORD_CLIENT_ID;
    delete process.env.ALLOWED_USER_IDS;
  });

  it('backfills missing tail from assistant message when partial deltas are truncated', () => {
    const runner = new ClaudeRunner({ bin: 'claude', cwd: '/tmp' });
    const text: string[] = [];
    runner.on('text', (delta) => text.push(delta));

    Reflect.apply(Reflect.get(runner, 'handleMessage'), runner, [{
      type: 'stream_event',
      session_id: 's',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hel' },
      },
    }]);
    Reflect.apply(Reflect.get(runner, 'handleMessage'), runner, [{
      type: 'assistant',
      session_id: 's',
      message: {
        id: 'm',
        role: 'assistant',
        model: 'sonnet',
        content: [{ type: 'text', text: 'hello' }],
      },
    }]);

    expect(text).toEqual(['hel', 'lo']);
  });

  it('does not duplicate text when partial deltas already covered full assistant text', () => {
    const runner = new ClaudeRunner({ bin: 'claude', cwd: '/tmp' });
    const text: string[] = [];
    runner.on('text', (delta) => text.push(delta));

    Reflect.apply(Reflect.get(runner, 'handleMessage'), runner, [{
      type: 'stream_event',
      session_id: 's',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hello' } },
    }]);
    Reflect.apply(Reflect.get(runner, 'handleMessage'), runner, [{
      type: 'assistant',
      session_id: 's',
      message: {
        id: 'm',
        role: 'assistant',
        model: 'sonnet',
        content: [{ type: 'text', text: 'hello' }],
      },
    }]);

    expect(text).toEqual(['hello']);
  });

  it('emits assistant text in full when no partial deltas arrived for that turn', () => {
    const runner = new ClaudeRunner({ bin: 'claude', cwd: '/tmp' });
    const text: string[] = [];
    runner.on('text', (delta) => text.push(delta));

    Reflect.apply(Reflect.get(runner, 'handleMessage'), runner, [{
      type: 'assistant',
      session_id: 's',
      message: {
        id: 'm',
        role: 'assistant',
        model: 'sonnet',
        content: [{ type: 'text', text: 'no partials here' }],
      },
    }]);

    expect(text).toEqual(['no partials here']);
  });

  it('resets partial accumulator across turns so a later assistant-only turn still emits', () => {
    const runner = new ClaudeRunner({ bin: 'claude', cwd: '/tmp' });
    const text: string[] = [];
    runner.on('text', (delta) => text.push(delta));

    Reflect.apply(Reflect.get(runner, 'handleMessage'), runner, [{
      type: 'stream_event',
      session_id: 's',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'turn1' } },
    }]);
    Reflect.apply(Reflect.get(runner, 'handleMessage'), runner, [{
      type: 'assistant',
      session_id: 's',
      message: { id: 'm1', role: 'assistant', model: 'sonnet', content: [{ type: 'text', text: 'turn1' }] },
    }]);
    Reflect.apply(Reflect.get(runner, 'handleMessage'), runner, [{
      type: 'assistant',
      session_id: 's',
      message: { id: 'm2', role: 'assistant', model: 'sonnet', content: [{ type: 'text', text: 'turn2 response' }] },
    }]);

    expect(text).toEqual(['turn1', 'turn2 response']);
  });

  it('concatenates split text blocks across tool_use when comparing to partial accumulator', () => {
    const runner = new ClaudeRunner({ bin: 'claude', cwd: '/tmp' });
    const text: string[] = [];
    const tools: string[] = [];
    runner.on('text', (delta) => text.push(delta));
    runner.on('toolUse', (b) => tools.push(b.name));

    Reflect.apply(Reflect.get(runner, 'handleMessage'), runner, [{
      type: 'stream_event',
      session_id: 's',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'before' } },
    }]);
    Reflect.apply(Reflect.get(runner, 'handleMessage'), runner, [{
      type: 'assistant',
      session_id: 's',
      message: {
        id: 'm',
        role: 'assistant',
        model: 'sonnet',
        content: [
          { type: 'text', text: 'before' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: {} },
          { type: 'text', text: ' and after' },
        ],
      },
    }]);

    expect(text).toEqual(['before', ' and after']);
    expect(tools).toEqual(['Bash']);
  });

  it('emits partial thinking deltas', () => {
    const runner = new ClaudeRunner({ bin: 'claude', cwd: '/tmp' });
    const thinking: string[] = [];
    runner.on('thinking', (delta) => thinking.push(delta));

    Reflect.apply(Reflect.get(runner, 'handleMessage'), runner, [{
      type: 'stream_event',
      session_id: 's',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'considering' },
      },
    }]);

    expect(thinking).toEqual(['considering']);
  });

  it('backfills missing thinking tail from assistant message', () => {
    const runner = new ClaudeRunner({ bin: 'claude', cwd: '/tmp' });
    const thinking: string[] = [];
    runner.on('thinking', (delta) => thinking.push(delta));

    Reflect.apply(Reflect.get(runner, 'handleMessage'), runner, [{
      type: 'stream_event',
      session_id: 's',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'consid' } },
    }]);
    Reflect.apply(Reflect.get(runner, 'handleMessage'), runner, [{
      type: 'assistant',
      session_id: 's',
      message: {
        id: 'm',
        role: 'assistant',
        model: 'sonnet',
        content: [{ type: 'thinking', thinking: 'considering' }],
      },
    }]);

    expect(thinking).toEqual(['consid', 'ering']);
  });


  it('emits tool results from user stream events', () => {
    const runner = new ClaudeRunner({ bin: 'claude', cwd: '/tmp' });
    const results: Array<{ toolUseId: string; content: string; isError?: boolean }> = [];
    runner.on('toolResult', (result) => results.push(result));

    Reflect.apply(Reflect.get(runner, 'handleMessage'), runner, [{
      type: 'user',
      session_id: 's',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: 'done',
          is_error: false,
        }],
      },
    }]);

    expect(results).toEqual([{ toolUseId: 'tool-1', content: 'done', isError: false }]);
  });

  it('marks result usage as final so trackers do not double count totals', () => {
    const runner = new ClaudeRunner({ bin: 'claude', cwd: '/tmp' });
    const usage: unknown[] = [];
    runner.on('usage', (delta) => usage.push(delta));

    Reflect.apply(Reflect.get(runner, 'handleMessage'), runner, [{
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 1,
      num_turns: 1,
      session_id: 's',
      total_cost_usd: 0.01,
      usage: { input_tokens: 10, output_tokens: 5 },
    }]);

    expect(usage).toEqual([expect.objectContaining({
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.01,
      final: true,
    })]);
  });

  it('reports per-turn cost from the cumulative total and skips empty usage of interrupted turns', () => {
    const runner = new ClaudeRunner({ bin: 'claude', cwd: '/tmp' });
    const usage: Array<{ costUsd?: number; inputTokens: number; final?: boolean }> = [];
    const ends: Array<number | undefined> = [];
    runner.on('usage', (u) => usage.push(u));
    runner.on('end', (f) => ends.push(f.total_cost_usd));
    const handle = (msg: unknown) => Reflect.apply(Reflect.get(runner, 'handleMessage'), runner, [msg]);
    const result = (total: number, tokens: number) => ({
      type: 'result',
      subtype: tokens ? 'success' : 'error_during_execution',
      is_error: false,
      duration_ms: 1,
      num_turns: 1,
      session_id: 's',
      total_cost_usd: total,
      usage: { input_tokens: tokens, output_tokens: tokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });

    handle(result(0.02, 10));
    handle(result(0.02, 0));
    handle(result(0.05, 10));

    expect(usage.map((u) => u.costUsd?.toFixed(2))).toEqual(['0.02', '0.03']);
    expect(ends.map((c) => c?.toFixed(2))).toEqual(['0.02', '0.00', '0.03']);
  });
});
