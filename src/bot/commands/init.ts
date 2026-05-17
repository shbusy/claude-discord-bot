import {
  ChannelType,
  EmbedBuilder,
  OverwriteType,
  PermissionFlagsBits,
  type GuildBasedChannel,
  type Guild,
  type CategoryChannel,
} from 'discord.js';
import type { SubCommand } from '../types.js';
import {
  GENERAL_CATEGORY_NAMES,
  PRIMARY_BROWSER_CHANNEL_NAME,
  PRIMARY_GENERAL_CATEGORY_NAME,
  PRIMARY_GENERAL_CHANNEL_NAME,
  PRIMARY_SESSIONS_CATEGORY_NAME,
  PRIMARY_USAGE_CHANNEL_NAME,
  SESSIONS_CATEGORY_NAMES,
} from '../channelNames.js';

export const initCommand: SubCommand = {
  name: 'init',
  build: (sub) => sub.setName('init').setDescription('봇이 사용할 채널 구조 자동 생성'),
  async handle(interaction, ctx) {
    if (!interaction.guild) {
      await interaction.reply({ content: '길드 내에서만 사용 가능합니다.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });

    const guild = interaction.guild;
    const me = guild.members.me;
    if (!me) {
      await interaction.editReply('봇이 길드에 참가하지 않았습니다.');
      return;
    }

    const mainCat = await findOrCreateCategory(
      guild,
      PRIMARY_GENERAL_CATEGORY_NAME,
      ctx.config.allowedUserIds,
      GENERAL_CATEGORY_NAMES,
    );

    const generalCh = await findOrCreateTextChannel(guild, PRIMARY_GENERAL_CHANNEL_NAME, mainCat.id);
    const browserCh = await findOrCreateTextChannel(guild, PRIMARY_BROWSER_CHANNEL_NAME, mainCat.id);
    const usageCh = await findOrCreateTextChannel(guild, PRIMARY_USAGE_CHANNEL_NAME, mainCat.id);
    const sessionsCat = await findOrCreateCategory(
      guild,
      PRIMARY_SESSIONS_CATEGORY_NAME,
      ctx.config.allowedUserIds,
      SESSIONS_CATEGORY_NAMES,
    );

    const embed = new EmbedBuilder()
      .setTitle('✅ 채널 구조 생성 완료')
      .setColor(0x57f287)
      .addFields(
        { name: '카테고리', value: mainCat.name, inline: true },
        { name: '일반 채널', value: `<#${generalCh.id}>`, inline: true },
        { name: '세션 브라우저', value: `<#${browserCh.id}>`, inline: true },
        { name: '사용량 채널', value: `<#${usageCh.id}>`, inline: true },
        { name: '세션 카테고리', value: sessionsCat.name, inline: true },
      )
      .setDescription('`/a4d browse` 또는 `/cdb browse`로 폴더를 고르거나 새 세션 채널을 생성할 수 있습니다.');

    await interaction.editReply({ embeds: [embed] });
  },
};

export function channelNameMatches(ch: GuildBasedChannel, type: ChannelType, names: readonly string[]): boolean {
  return ch.type === type && names.includes(ch.name);
}

async function findOrCreateCategory(
  guild: Guild,
  name: string,
  allowedUserIds: string[],
  aliases: readonly string[] = [name],
): Promise<CategoryChannel> {
  const existing = guild.channels.cache.find(
    (ch) => channelNameMatches(ch, ChannelType.GuildCategory, aliases),
  );
  if (existing) return existing as CategoryChannel;

  const overwrites = buildCategoryOverwrites(guild.id, guild.members.me!.id, allowedUserIds);

  return guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    permissionOverwrites: overwrites,
  });
}

export function buildCategoryOverwrites(guildId: string, botUserId: string, allowedUserIds: string[]) {
  const sessionUsePermissions = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AddReactions,
  ];

  return [
    {
      id: guildId,
      type: OverwriteType.Role,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: botUserId,
      type: OverwriteType.Member,
      allow: [
        ...sessionUsePermissions,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageThreads,
      ],
    },
    ...allowedUserIds.map((userId) => ({
      id: userId,
      type: OverwriteType.Member,
      allow: sessionUsePermissions,
    })),
  ];
}

async function findOrCreateTextChannel(guild: Guild, name: string, parentId: string) {
  const existing = guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildText && ch.name === name && ch.parentId === parentId,
  );
  if (existing) return existing;

  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: parentId,
  });
}
