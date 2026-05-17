import type { Message } from 'discord.js';
import type { Plugin, PluginContext } from './api.js';

export class PluginRegistry {
  private readonly plugins = new Map<string, Plugin>();

  async register(plugin: Plugin, ctx: PluginContext): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      await this.unregister(plugin.name);
    }
    if (plugin.onLoad) {
      await plugin.onLoad(ctx);
    }
    this.plugins.set(plugin.name, plugin);
  }

  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) return;
    if (plugin.onUnload) {
      await plugin.onUnload();
    }
    this.plugins.delete(name);
  }

  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  list(): Plugin[] {
    return [...this.plugins.values()];
  }

  async runUserMessageHooks(msg: Message, ctx: PluginContext): Promise<boolean> {
    for (const plugin of this.plugins.values()) {
      const result = await plugin.hooks?.onUserMessage?.(msg, ctx);
      if (result?.handled) return true;
    }
    return false;
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  async unregisterAll(): Promise<void> {
    for (const name of [...this.plugins.keys()]) {
      await this.unregister(name);
    }
  }
}
