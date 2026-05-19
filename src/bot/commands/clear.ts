import { ChannelType, type TextChannel } from 'discord.js';
import type { SubCommand } from '../types.js';
import { restoreSessionFromInteractionTopic } from './sessionTopic.js';

export const clearCommand: SubCommand = {
  name: 'clear',
  build: (sub) => sub.setName('clear').setDescription('대화 컨텍스트 초기화 (채널 유지, 이전 대화 기록 제거)'),
  async handle(interaction, ctx) {
    if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
      await interaction.reply({ content: '텍스트 세션 채널에서만 사용할 수 있습니다.', ephemeral: true });
      return;
    }
    restoreSessionFromInteractionTopic(interaction, ctx);
    const cleared = await ctx.sessions.clearContext(interaction.channelId);
    if (!cleared) {
      await interaction.reply({ content: '활성 세션이 없습니다.', ephemeral: true });
      return;
    }
    await ctx.sessions.syncTopic(interaction.channel as TextChannel);
    await interaction.reply({ content: '🧹 컨텍스트를 초기화했습니다. 다음 메시지부터 새 대화로 시작합니다.', ephemeral: true });
  },
};
