import { watch } from 'chokidar';
import { lstat, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Logger } from 'pino';
import type { Plugin, PluginContext } from './api.js';
import { PluginRegistry } from './registry.js';
import { assertRealPathInsideRoot, isPathInsideRoot } from '../util/pathSecurity.js';

export class PluginLoader {
  private watcher: ReturnType<typeof watch> | null = null;

  constructor(
    private readonly registry: PluginRegistry,
    private readonly pluginDir: string,
    private readonly ctx: PluginContext,
    private readonly log: Logger,
  ) {}

  async loadAll(): Promise<void> {
    try {
      const dirStat = await stat(this.pluginDir).catch(() => null);
      if (!dirStat?.isDirectory()) {
        this.log.info({ dir: this.pluginDir }, '플러그인 디렉토리 없음, 건너뜀');
        return;
      }
      const files = await readdir(this.pluginDir);
      for (const file of files) {
        if (!file.endsWith('.js') && !file.endsWith('.ts')) continue;
        await this.loadFile(join(this.pluginDir, file));
      }
    } catch (err) {
      this.log.error({ err }, '플러그인 로드 실패');
    }
  }

  async loadNamed(name: string): Promise<boolean> {
    if (!isSafePluginName(name)) return false;
    const candidates = [`${name}.js`, `${name}.ts`];
    for (const candidate of candidates) {
      const filePath = resolve(this.pluginDir, candidate);
      if (!isPathInsideRoot(filePath, this.pluginDir)) continue;
      const fileStat = await lstat(filePath).catch(() => null);
      if (fileStat?.isFile()) {
        await this.loadFile(filePath);
        return true;
      }
    }
    return false;
  }

  startWatching(): void {
    if (this.watcher) return;
    this.watcher = watch(this.pluginDir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500 },
    });
    this.watcher.on('add', (path) => void this.loadFile(path));
    this.watcher.on('change', (path) => void this.loadFile(path));
    this.watcher.on('unlink', (path) => {
      const name = pluginNameFromPath(path);
      void this.registry.unregister(name);
      this.log.info({ name }, '플러그인 언로드 (파일 삭제)');
    });
  }

  async stopWatching(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private async loadFile(filePath: string): Promise<void> {
    try {
      const resolvedPath = resolve(filePath);
      if (!isPathInsideRoot(resolvedPath, this.pluginDir)) {
        this.log.warn({ filePath }, '플러그인 디렉토리 밖의 파일 로드 거부');
        return;
      }
      assertRealPathInsideRoot(resolvedPath, this.pluginDir);
      // Cache bust for hot reload
      const url = pathToFileURL(resolvedPath).href + '?v=' + Date.now();
      const mod = (await import(url)) as { default?: Plugin };
      const plugin = mod.default;
      if (!plugin || !plugin.name || !plugin.version) {
        this.log.warn({ filePath }, '유효하지 않은 플러그인 (name/version 누락)');
        return;
      }
      await this.registry.register(plugin, this.ctx);
      this.log.info({ name: plugin.name, version: plugin.version }, '플러그인 로드');
    } catch (err) {
      this.log.error({ err, filePath }, '플러그인 로드 실패');
    }
  }
}

export function isSafePluginName(name: string): boolean {
  return /^[A-Za-z0-9_-]{1,80}$/.test(name);
}

function pluginNameFromPath(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath;
  return base.replace(/\.(js|ts)$/, '');
}
