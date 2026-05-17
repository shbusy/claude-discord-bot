import { EmbedBuilder } from 'discord.js';
import type { SubCommand } from '../types.js';

export const configCommand: SubCommand = {
  name: 'config',
  build: (sub) => sub.setName('config').setDescription('봇 설정 조회/변경'),
  async handle(interaction, ctx) {
    const embed = new EmbedBuilder()
      .setTitle('⚙️ 봇 설정')
      .setColor(0x5865f2)
      .addFields(
        { name: '기본 모델', value: ctx.config.defaultModel, inline: true },
        { name: '기본 언어', value: ctx.config.defaultLang, inline: true },
        { name: '기본 작업 디렉토리', value: ctx.config.defaultCwd, inline: true },
        { name: 'claude 바이너리', value: ctx.config.claudeBin, inline: true },
        { name: 'idle 타임아웃', value: `${ctx.config.idleTimeoutMs / 1000}s`, inline: true },
        { name: '허용 사용자 수', value: `${ctx.config.allowedUserIds.length}명`, inline: true },
        { name: 'CDB 홈', value: ctx.config.cdbHome, inline: true },
        { name: '플러그인', value: `${ctx.pluginRegistry?.list().length ?? 0}개 로드`, inline: true },
      );
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
