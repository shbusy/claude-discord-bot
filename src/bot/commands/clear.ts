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
    await interaction.deferReply({ ephemeral: true });
    restoreSessionFromInteractionTopic(interaction, ctx);
    const cleared = await ctx.sessions.clearContext(interaction.channelId);
    if (!cleared) {
      await interaction.editReply({ content: '활성 세션이 없습니다.' });
      return;
    }
    await interaction.editReply({ content: '🧹 컨텍스트를 초기화했습니다. 다음 메시지부터 새 대화로 시작합니다.' });
    // 토픽 변경은 속도 제한으로 몇 분씩 대기할 수 있어 응답을 붙잡지 않도록 뒤에서 처리한다.
    void ctx.sessions.syncTopic(interaction.channel as TextChannel).catch((err) =>
      ctx.log.warn({ err }, '토픽 동기화 실패'),
    );
  },
};
