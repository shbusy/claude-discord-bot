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

  it('emits partial text deltas and avoids replaying full assistant text afterward', () => {
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

    expect(text).toEqual(['hel']);
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
});
