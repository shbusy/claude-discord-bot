import { EmbedBuilder } from 'discord.js';
import type { SubCommand } from '../types.js';
import { findSession, listSessions, type SessionInfo } from '../../claude/sessionStore.js';
import { restoreSessionFromInteractionTopic } from './sessionTopic.js';
import type { SessionMeta } from '../../session/topicCodec.js';

export const resumeCommand: SubCommand = {
  name: 'resume',
  build: (sub) =>
    sub
      .setName('resume')
      .setDescription('현 채널의 세션 재개')
      .addStringOption((o) => o.setName('session_id').setDescription('세션 ID').setRequired(false)),
  async handle(interaction, ctx) {
    await interaction.deferReply({ ephemeral: true });
    restoreSessionFromInteractionTopic(interaction, ctx);
    const sessionId = interaction.options.getString('session_id');

    if (!sessionId) {
      const existing = ctx.sessions.get(interaction.channelId);
      const target = await resolveResumeTarget(existing?.meta, ctx.config.defaultCwd);
      if (!target) {
        await interaction.editReply('재개할 세션을 찾지 못했습니다. `session_id`를 지정해주세요.');
        return;
      }
      await ctx.sessions.resumeSession(interaction.channelId, target.sessionId, { cwd: target.cwd });
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🔄 세션 재개 준비')
            .setDescription(`세션 \`${target.sessionId}\`이 다음 메시지부터 재개됩니다.`)
            .addFields(
              { name: 'cwd', value: target.cwd, inline: true },
              { name: 'model', value: ctx.sessions.get(interaction.channelId)?.meta.model ?? ctx.config.defaultModel, inline: true },
            )
            .setColor(0x57f287),
        ],
      });
      return;
    }

    // 지정한 sessionId로 세션 정보 조회
    const sessionInfo = await findSession(sessionId);
    const cwd = sessionInfo?.cwd ?? ctx.config.defaultCwd;

    await ctx.sessions.resumeSession(interaction.channelId, sessionId, { cwd });
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🔄 세션 재개 준비')
          .setDescription(`세션 \`${sessionId}\`이 다음 메시지부터 재개됩니다.`)
          .addFields(
            { name: 'cwd', value: cwd, inline: true },
            { name: 'model', value: ctx.sessions.get(interaction.channelId)?.meta.model ?? ctx.config.defaultModel, inline: true },
          )
          .setColor(0x57f287),
      ],
    });
  },
};

export async function resolveResumeTarget(
  existing: SessionMeta | undefined,
  defaultCwd: string,
  listForCwd: (cwd: string) => Promise<SessionInfo[]> = listSessions,
): Promise<{ sessionId: string; cwd: string } | null> {
  if (existing?.sessionId) {
    return { sessionId: existing.sessionId, cwd: existing.cwd };
  }
  const cwd = existing?.cwd ?? defaultCwd;
  const latest = (await listForCwd(cwd))[0];
  if (!latest) return null;
  return { sessionId: latest.sessionId, cwd: latest.cwd };
}
