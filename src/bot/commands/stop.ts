import type { SubCommand } from '../types.js';
import { restoreSessionFromInteractionTopic } from './sessionTopic.js';

export const stopCommand: SubCommand = {
  name: 'stop',
  build: (sub) => sub.setName('stop').setDescription('진행 중 응답 중단'),
  async handle(interaction, ctx) {
    restoreSessionFromInteractionTopic(interaction, ctx);
    const stopped = await ctx.sessions.stop(interaction.channelId);
    if (stopped) {
      await interaction.reply({ content: '⏹ 응답을 중단했습니다.', ephemeral: true });
    } else {
      await interaction.reply({ content: '진행 중인 응답이 없습니다.', ephemeral: true });
    }
  },
};
