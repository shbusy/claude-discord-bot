import { ChannelType, type ChatInputCommandInteraction, type TextChannel } from 'discord.js';
import type { AppContext } from '../types.js';

export function restoreSessionFromInteractionTopic(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
): void {
  if (ctx.sessions.get(interaction.channelId)) return;
  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) return;
  ctx.sessions.restoreFromTopic(interaction.channelId, (interaction.channel as TextChannel).topic);
}
