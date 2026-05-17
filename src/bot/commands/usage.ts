import { EmbedBuilder } from 'discord.js';
import type { SubCommand } from '../types.js';
import { queryUsageSummary, queryModelBreakdown } from '../../usage/db.js';

export const usageCommand: SubCommand = {
  name: 'usage',
  build: (sub) =>
    sub
      .setName('usage')
      .setDescription('사용량 리포트')
      .addStringOption((o) =>
        o
          .setName('period')
          .setDescription('기간')
          .addChoices(
            { name: 'day', value: 'day' },
            { name: 'week', value: 'week' },
            { name: 'month', value: 'month' },
          )
          .setRequired(false),
      ),
  async handle(interaction, ctx) {
    const period = (interaction.options.getString('period') ?? 'day') as 'day' | 'week' | 'month';
    const periodLabel = { day: '오늘', week: '이번 주', month: '이번 달' }[period];

    const summary = queryUsageSummary(ctx.config.cdbHome, period);
    const breakdown = queryModelBreakdown(ctx.config.cdbHome, period);

    const embed = new EmbedBuilder()
      .setTitle(`📊 사용량 리포트 — ${periodLabel}`)
      .setColor(0x5865f2)
      .addFields(
        { name: 'Input 토큰', value: summary.total_input.toLocaleString(), inline: true },
        { name: 'Output 토큰', value: summary.total_output.toLocaleString(), inline: true },
        { name: '총 비용', value: `$${summary.total_cost.toFixed(4)}`, inline: true },
        { name: '요청 수', value: summary.count.toLocaleString(), inline: true },
      );

    if (breakdown.length > 0) {
      const lines = breakdown.map(
        (b) => `**${b.model}**: in ${b.total_input.toLocaleString()} / out ${b.total_output.toLocaleString()} ($${b.total_cost.toFixed(4)})`,
      );
      embed.addFields({ name: '모델별 분포', value: lines.join('\n') });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
