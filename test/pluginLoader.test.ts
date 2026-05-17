import { describe, expect, it } from 'vitest';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isSafePluginName, PluginLoader } from '../src/plugins/loader.js';
import { PluginRegistry } from '../src/plugins/registry.js';

const noopLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as never;

describe('PluginLoader', () => {
  it('loads a named plugin from the plugin directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cdb-plugin-'));
    await writeFile(join(dir, 'sample.js'), [
      'export default {',
      '  name: "sample",',
      '  version: "1.0.0",',
      '};',
    ].join('\n'));

    const registry = new PluginRegistry();
    const loader = new PluginLoader(registry, dir, {} as never, noopLogger);

    await expect(loader.loadNamed('sample')).resolves.toBe(true);
    expect(registry.has('sample')).toBe(true);
  });

  it('returns false when a named plugin file does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cdb-plugin-'));
    const registry = new PluginRegistry();
    const loader = new PluginLoader(registry, dir, {} as never, noopLogger);

    await expect(loader.loadNamed('missing')).resolves.toBe(false);
  });

  it('rejects path traversal in named plugin loading', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cdb-plugin-'));
    const registry = new PluginRegistry();
    const loader = new PluginLoader(registry, dir, {} as never, noopLogger);

    expect(isSafePluginName('../outside')).toBe(false);
    await expect(loader.loadNamed('../outside')).resolves.toBe(false);
  });

  it('rejects symlinked named plugins that point outside the plugin directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cdb-plugin-'));
    const outside = await mkdtemp(join(tmpdir(), 'cdb-plugin-outside-'));
    await writeFile(join(outside, 'outside.js'), [
      'export default {',
      '  name: "outside",',
      '  version: "1.0.0",',
      '};',
    ].join('\n'));
    await symlink(join(outside, 'outside.js'), join(dir, 'linked.js'));
    const registry = new PluginRegistry();
    const loader = new PluginLoader(registry, dir, {} as never, noopLogger);

    await expect(loader.loadNamed('linked')).resolves.toBe(false);
    expect(registry.has('outside')).toBe(false);
  });

  it('runs loaded user message hooks until one handles the message', async () => {
    const registry = new PluginRegistry();
    const calls: string[] = [];

    await registry.register({
      name: 'first',
      version: '1.0.0',
      hooks: {
        async onUserMessage() {
          calls.push('first');
          return { handled: false };
        },
      },
    }, {} as never);
    await registry.register({
      name: 'second',
      version: '1.0.0',
      hooks: {
        async onUserMessage() {
          calls.push('second');
          return { handled: true };
        },
      },
    }, {} as never);
    await registry.register({
      name: 'third',
      version: '1.0.0',
      hooks: {
        async onUserMessage() {
          calls.push('third');
          return { handled: true };
        },
      },
    }, {} as never);

    await expect(registry.runUserMessageHooks({} as never, {} as never)).resolves.toBe(true);
    expect(calls).toEqual(['first', 'second']);
  });
});
