import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { AppContext, SubCommand } from '../types.js';
import { statusCommand } from './status.js';
import { makeStub } from './stub.js';

const subcommands: SubCommand[] = [
  statusCommand,
  makeStub({ name: 'init', description: '봇이 사용할 채널 구조 자동 생성', milestone: 'M7' }),
  makeStub({
    name: 'new',
    description: '새 세션 채널 생성',
    milestone: 'M7',
    build: (s) =>
      s
        .addStringOption((o) => o.setName('name').setDescription('세션 이름').setRequired(false))
        .addStringOption((o) => o.setName('path').setDescription('작업 디렉토리').setRequired(false))
        .addStringOption((o) =>
          o
            .setName('model')
            .setDescription('모델')
            .addChoices(
              { name: 'opus', value: 'opus' },
              { name: 'sonnet', value: 'sonnet' },
              { name: 'haiku', value: 'haiku' },
            )
            .setRequired(false),
        ),
  }),
  makeStub({
    name: 'resume',
    description: '현 채널의 세션 재개',
    milestone: 'M3',
    build: (s) => s.addStringOption((o) => o.setName('session_id').setDescription('세션 ID').setRequired(false)),
  }),
  makeStub({
    name: 'model',
    description: '현 채널 모델 변경',
    milestone: 'M3',
    build: (s) =>
      s.addStringOption((o) =>
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
  }),
  makeStub({ name: 'stop', description: '진행 중 응답 중단', milestone: 'M2' }),
  makeStub({
    name: 'usage',
    description: '사용량 리포트',
    milestone: 'M6',
    build: (s) =>
      s.addStringOption((o) =>
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
  }),
  makeStub({
    name: 'plugin',
    description: '플러그인 관리',
    milestone: 'M8',
    build: (s) =>
      s
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('동작')
            .addChoices(
              { name: 'list', value: 'list' },
              { name: 'reload', value: 'reload' },
              { name: 'enable', value: 'enable' },
              { name: 'disable', value: 'disable' },
            )
            .setRequired(true),
        )
        .addStringOption((o) => o.setName('name').setDescription('플러그인 이름').setRequired(false)),
  }),
  makeStub({ name: 'config', description: '봇 설정 조회/변경', milestone: 'M9' }),
];

const byName = new Map<string, SubCommand>(subcommands.map((c) => [c.name, c]));

export function buildCdbCommand(): SlashCommandBuilder {
  const cmd = new SlashCommandBuilder().setName('cdb').setDescription('Claude Code Discord Bot');
  for (const s of subcommands) {
    cmd.addSubcommand((sub) => s.build(sub));
  }
  return cmd;
}

export async function dispatch(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (interaction.commandName !== 'cdb') return;
  const sub = interaction.options.getSubcommand(true);
  const handler = byName.get(sub);
  if (!handler) {
    await interaction.reply({ content: `알 수 없는 서브커맨드: ${sub}`, ephemeral: true });
    return;
  }
  if (!isAllowed(interaction.user.id, ctx)) {
    ctx.log.warn({ userId: interaction.user.id, sub }, '허가되지 않은 사용자');
    await interaction.reply({ content: '권한이 없습니다.', ephemeral: true });
    return;
  }
  try {
    await handler.handle(interaction, ctx);
  } catch (err) {
    ctx.log.error({ err, sub }, '커맨드 처리 실패');
    const msg = `❌ 처리 중 오류: \`${(err as Error).message}\``;
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: msg, ephemeral: true });
    } else {
      await interaction.reply({ content: msg, ephemeral: true });
    }
  }
}

function isAllowed(userId: string, ctx: AppContext): boolean {
  return ctx.config.allowedUserIds.includes(userId);
}
