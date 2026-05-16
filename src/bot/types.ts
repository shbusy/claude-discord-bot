import type { Client, ChatInputCommandInteraction, SlashCommandSubcommandBuilder } from 'discord.js';
import type { Logger } from 'pino';
import type { Config } from '../config/schema.js';

export interface AppContext {
  client: Client;
  config: Config;
  log: Logger;
  startedAt: Date;
}

export interface SubCommand {
  name: string;
  build(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder;
  handle(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void>;
}
