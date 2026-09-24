import { ChannelType, EmbedBuilder, type Guild } from 'discord.js';
import type { SubCommand } from '../types.js';
import { encodeTopic } from '../../session/topicCodec.js';
import { SESSIONS_CATEGORY_NAMES } from '../channelNames.js';
import { buildSessionChannelName } from '../../ui/directoryBrowser.js';
import { resolveWithinRoot } from '../../util/pathSecurity.js';

export const newCommand: SubCommand = {
  name: 'new',
  build: (sub) =>
    sub
      .setName('new')
      .setDescription('새 세션 채널 생성')
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
      )
      .addStringOption((o) =>
        o
          .setName('permission_mode')
          .setDescription('권한 모드')
          .addChoices(
            { name: 'bypassPermissions (완전 자동)', value: 'bypassPermissions' },
            { name: 'auto (분류기 기반 자동)', value: 'auto' },
            { name: 'acceptEdits (편집만 자동)', value: 'acceptEdits' },
            { name: 'default (매번 확인)', value: 'default' },
            { name: 'plan (툴 실행 없음)', value: 'plan' },
          )
          .setRequired(false),
      ),
  async handle(interaction, ctx) {
    if (!interaction.guild) {
      await interaction.reply({ content: '길드 내에서만 사용 가능합니다.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const name = interaction.options.getString('name') ?? `session-${Date.now().toString(36)}`;
    const cwd = resolveWithinRoot(interaction.options.getString('path'), ctx.config.defaultCwd);
    const model = interaction.options.getString('model') ?? ctx.config.defaultModel;
    const permissionMode = interaction.options.getString('permission_mode') ?? ctx.config.permissionMode;

    const sessionsCat = guild.channels.cache.find(
      (ch) => ch.type === ChannelType.GuildCategory && SESSIONS_CATEGORY_NAMES.includes(ch.name),
    );

    const channelName = buildSessionChannelName(name);
    const meta = {
      sessionId: '',
      cwd,
      model,
      permissionMode,
      lastActiveAt: Date.now(),
    };

    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: sessionsCat?.id,
      topic: encodeTopic(meta),
    });

    // SessionManager에 등록
    await ctx.sessions.createSession(channel.id, { cwd, model, permissionMode });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🆕 세션 채널 생성')
          .setColor(0x57f287)
          .addFields(
            { name: '채널', value: `<#${channel.id}>`, inline: true },
            { name: 'cwd', value: cwd, inline: true },
            { name: 'model', value: model, inline: true },
            { name: 'permission', value: permissionMode, inline: true },
          )
          .setDescription('채널에서 봇을 멘션하면 대화가 시작됩니다.'),
      ],
    });
  },
};
