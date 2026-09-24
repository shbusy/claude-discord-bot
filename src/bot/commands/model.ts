import { EmbedBuilder } from 'discord.js';
import type { SubCommand } from '../types.js';
import { restoreSessionFromInteractionTopic } from './sessionTopic.js';

export const modelCommand: SubCommand = {
  name: 'model',
  build: (sub) =>
    sub
      .setName('model')
      .setDescription('현 채널 모델 변경')
      .addStringOption((o) =>
        o
          .setName('model')
          .setDescription('모델')
          .addChoices(
            { name: 'opus', value: 'opus' },
            { name: 'sonnet', value: 'sonnet' },
            { name: 'haiku', value: 'haiku' },
          )
          .setRequired(true),
      ),
  async handle(interaction, ctx) {
    restoreSessionFromInteractionTopic(interaction, ctx);
    const model = interaction.options.getString('model', true);

    // 세션이 없으면 생성
    if (!ctx.sessions.get(interaction.channelId)) {
      await ctx.sessions.createSession(interaction.channelId, { model });
    } else {
      ctx.sessions.setModel(interaction.channelId, model);
    }

    const session = ctx.sessions.get(interaction.channelId)!;
    const isAlive = session.runner?.isAlive === true;

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🔧 모델 변경')
          .setDescription(`모델이 \`${model}\`로 변경되었습니다.`)
          .addFields({
            name: '적용 시점',
            value: isAlive ? '즉시 (실행 중인 세션에 바로 반영)' : '다음 메시지부터',
          })
          .setColor(0x5865f2),
      ],
      ephemeral: true,
    });
  },
};
