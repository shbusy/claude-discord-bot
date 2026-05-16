import { EmbedBuilder } from 'discord.js';
import type { SubCommand } from '../types.js';

export const statusCommand: SubCommand = {
  name: 'status',
  build: (sub) => sub.setName('status').setDescription('봇 및 현재 채널의 세션 상태'),
  async handle(interaction, ctx) {
    const uptimeSec = Math.floor((Date.now() - ctx.startedAt.getTime()) / 1000);
    const embed = new EmbedBuilder()
      .setTitle('🤖 Claude Discord Bot 상태')
      .addFields(
        { name: '버전', value: '0.0.1', inline: true },
        { name: '업타임', value: `${uptimeSec}s`, inline: true },
        { name: '모델 기본값', value: ctx.config.defaultModel, inline: true },
        { name: 'claude 바이너리', value: ctx.config.claudeBin, inline: true },
        { name: '채널', value: `<#${interaction.channelId}>`, inline: true },
      )
      .setColor(0x5865f2)
      .setTimestamp(new Date());
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
