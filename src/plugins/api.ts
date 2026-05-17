import type { Client, Message } from 'discord.js';
import type { Logger } from 'pino';
import type { Config } from '../config/schema.js';
import type { SessionManager } from '../session/manager.js';

export interface PluginContext {
  client: Client;
  config: Config;
  log: Logger;
  sessions: SessionManager;
}

export interface HookResult {
  /** If true, stops further processing of this event. */
  handled?: boolean;
}

export interface SlashCommandSpec {
  name: string;
  description: string;
  handle(interaction: unknown, ctx: PluginContext): Promise<void>;
}

export interface Plugin {
  name: string;
  version: string;
  onLoad?(ctx: PluginContext): Promise<void>;
  onUnload?(): Promise<void>;
  commands?: SlashCommandSpec[];
  hooks?: {
    onUserMessage?(msg: Message, ctx: PluginContext): Promise<HookResult>;
  };
}
