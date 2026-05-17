import type { Client, ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from 'discord.js';
import type { Logger } from 'pino';
import type { Config } from '../config/schema.js';
import type { SessionManager } from '../session/manager.js';
import type { PluginRegistry } from '../plugins/registry.js';
import type { PluginLoader } from '../plugins/loader.js';

export interface AppContext {
  client: Client;
  config: Config;
  log: Logger;
  startedAt: Date;
  sessions: SessionManager;
  pluginRegistry?: PluginRegistry;
  pluginLoader?: PluginLoader;
}

export interface SubCommand {
  name: string;
  build(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder;
  handle(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void>;
}
