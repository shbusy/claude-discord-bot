import { EmbedBuilder } from 'discord.js';
import type { ClaudeRunner } from '../../claude/runner.js';
import type { SubCommand } from '../types.js';
import { restoreSessionFromInteractionTopic } from './sessionTopic.js';

export const statusCommand: SubCommand = {
  name: 'status',
  build: (sub) => sub.setName('status').setDescription('봇 및 현재 채널의 세션 상태'),
  async handle(interaction, ctx) {
    restoreSessionFromInteractionTopic(interaction, ctx);
    const uptimeSec = Math.floor((Date.now() - ctx.startedAt.getTime()) / 1000);
    const session = ctx.sessions.get(interaction.channelId);

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

    if (session) {
      embed.addFields(
        { name: '세션 ID', value: session.meta.sessionId || '(미시작)', inline: true },
        { name: '세션 cwd', value: session.meta.cwd, inline: true },
        { name: '세션 모델', value: session.meta.model, inline: true },
        { name: 'Runner 상태', value: runnerStatus(session.runner, session.meta.lastActiveAt, ctx.config.idleTimeoutMs), inline: true },
      );
    } else {
      embed.addFields({ name: '세션', value: '이 채널에 연결된 세션 없음' });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

function runnerStatus(runner: ClaudeRunner | null, lastActiveAt: number, idleTimeoutMs: number): string {
  if (runner?.isBusy) return '🟢 응답 중';
  if (runner?.isAlive) {
    const leftMin = Math.max(0, Math.ceil((lastActiveAt + idleTimeoutMs - Date.now()) / 60000));
    return `🟡 대기 (캐시 유지, ${leftMin}분 후 종료)`;
  }
  return '⚫ 종료';
}
