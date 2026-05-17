import { ChannelType } from 'discord.js';
import type { SubCommand } from '../types.js';
import { restoreSessionFromInteractionTopic } from './sessionTopic.js';

export const closeCommand: SubCommand = {
  name: 'close',
  build: (sub) => sub.setName('close').setDescription('세션 중단 후 현재 세션 채널 삭제'),
  async handle(interaction, ctx) {
    if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
      await interaction.reply({ content: '텍스트 세션 채널에서만 사용할 수 있습니다.', ephemeral: true });
      return;
    }
    restoreSessionFromInteractionTopic(interaction, ctx);
    await interaction.reply({ content: '세션을 닫고 채널을 삭제합니다.', ephemeral: true });
    await ctx.sessions.close(interaction.channelId);
    await interaction.channel.delete('CDB session closed').catch((err) => {
      ctx.log.warn({ err, channelId: interaction.channelId }, '세션 채널 삭제 실패');
    });
  },
};
