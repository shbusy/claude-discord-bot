import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ChannelType } from 'discord.js';
import { ThreadRouter, existingFiles } from '../src/ui/threadRouter.js';

function harness(opts: { existingThread?: boolean; failFirstStart?: boolean } = {}) {
  const sends: Array<{ title: string }> = [];
  const thread = {
    send: vi.fn(async (payload: { embeds: Array<{ data: { title: string } }> }) => {
      sends.push({ title: payload.embeds[0]!.data.title });
    }),
    setArchived: vi.fn(async () => undefined),
  };
  let starts = 0;
  const parentMsg = {
    thread: opts.existingThread ? thread : null,
    startThread: vi.fn(async () => {
      starts += 1;
      if (opts.failFirstStart && starts === 1) throw new Error('The message already has a thread');
      return thread;
    }),
  };
  const channel = { type: ChannelType.GuildText, threads: { create: vi.fn() } };
  const router = new ThreadRouter(channel as never);
  router.setParent(parentMsg as never);
  return { router, thread, parentMsg, channel, sends };
}

describe('ThreadRouter thread reuse', () => {
  it('creates one shared thread for concurrent tool calls', async () => {
    const { router, parentMsg, thread } = harness();

    await Promise.all([
      router.postToolUse('call_1', 'Read', { file: 'a.ts' }),
      router.postToolUse('call_2', 'Bash', { command: 'ls' }),
      router.postToolUse('call_3', 'Edit', { file: 'b.ts' }),
    ]);

    expect(parentMsg.startThread).toHaveBeenCalledTimes(1);
    expect(thread.send).toHaveBeenCalledTimes(3);
  });

  it('reuses a thread already attached to the parent message', async () => {
    const { router, parentMsg, thread } = harness({ existingThread: true });

    await router.postToolUse('call_1', 'Read', {});

    expect(parentMsg.startThread).not.toHaveBeenCalled();
    expect(thread.send).toHaveBeenCalledTimes(1);
  });

  it('retries thread creation after a failure instead of staying broken', async () => {
    const { router, parentMsg, thread } = harness({ failFirstStart: true });

    await expect(router.postToolUse('call_1', 'Read', {})).rejects.toThrow();
    await router.postToolUse('call_2', 'Bash', {});

    expect(parentMsg.startThread).toHaveBeenCalledTimes(2);
    expect(thread.send).toHaveBeenCalledTimes(1);
  });
});

describe('ThreadRouter tool results', () => {
  it('labels the result with its tool name and keeps it after the invocation', async () => {
    const { router, sends } = harness();

    await router.postToolUse('call_1', 'Bash', { command: 'ls' });
    await router.postToolResult('call_1', 'a.ts\nb.ts');

    expect(sends).toEqual([{ title: '🛠 Bash' }, { title: '📤 Bash 결과' }]);
  });

  it('drops results for tools whose invocation was never posted', async () => {
    const { router, thread } = harness();

    await router.postToolUse('call_1', 'Bash', {});
    await router.postToolResult('call_ask', 'answered');

    expect(thread.send).toHaveBeenCalledTimes(1);
  });

  it('archives the shared thread on finalize', async () => {
    const { router, thread } = harness();

    await router.postToolUse('call_1', 'Read', {});
    await router.finalize();

    expect(thread.setArchived).toHaveBeenCalledWith(true);
  });
});

describe('ThreadRouter file attachments', () => {
  it('keeps readable files and drops missing files before Discord upload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cdb-thread-'));
    const file = join(dir, 'out.txt');
    await writeFile(file, 'ok');

    await expect(existingFiles([file, join(dir, 'missing.txt')])).resolves.toEqual([file]);
  });
});
