import { mkdir, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import type { AppContext } from '../bot/types.js';
import { encodeTopic } from '../session/topicCodec.js';
import { SESSIONS_CATEGORY_NAMES } from '../bot/channelNames.js';
import { isPathInsideRoot, resolveWithinRoot } from '../util/pathSecurity.js';

const CUSTOM_PREFIX = 'cdb_browse';
const pathTokens = new Map<string, { path: string; permissionMode: string; root: string }>();

const DEFAULT_BROWSE_PERMISSION_MODE = 'auto';

const PERMISSION_MODE_OPTIONS: Array<{ value: string; label: string; description: string }> = [
  { value: 'default', label: 'default', description: 'Shift+Tab: 위험 작업마다 사용자 확인' },
  { value: 'acceptEdits', label: 'auto-accept edits', description: 'Shift+Tab: 파일 편집만 자동 수락' },
  { value: 'plan', label: 'plan mode', description: 'Shift+Tab: 계획 모드, 툴 실행 없음' },
  { value: 'bypassPermissions', label: 'bypass permissions', description: 'Shift+Tab: 완전 자동, 모든 툴 프롬프트 없음' },
];

function isSelectablePermissionMode(value: string): boolean {
  return PERMISSION_MODE_OPTIONS.some((o) => o.value === value);
}

export async function showDirectoryBrowser(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
  startPath?: string | null,
  permissionMode?: string,
): Promise<void> {
  const root = resolve(ctx.config.defaultCwd);
  const cwd = resolveWithinRoot(startPath, root);
  const payload = await buildBrowserPayload(cwd, root, permissionMode ?? DEFAULT_BROWSE_PERMISSION_MODE);
  await interaction.reply({ ...payload, ephemeral: true });
}

export async function handleDirectoryBrowserInteraction(
  interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction,
  ctx: AppContext,
): Promise<boolean> {
  if (!interaction.customId.startsWith(CUSTOM_PREFIX)) return false;
  if (!ctx.config.allowedUserIds.includes(interaction.user.id)) {
    await interaction.reply({ content: '권한이 없습니다.', ephemeral: true });
    return true;
  }

  if (interaction.isModalSubmit()) {
    const [, action, token] = interaction.customId.split(':');
    if (action !== 'mkdir') return false;
    const current = pathTokens.get(token ?? '');
    if (!current) {
      await interaction.reply({ content: '브라우저 상태가 만료되었습니다. `/cdb browse`를 다시 실행해주세요.', ephemeral: true });
      return true;
    }
    const dirnameInput = interaction.fields.getTextInputValue('dirname').trim();
    try {
      const result = await createChildDirectory(current.path, dirnameInput, current.root);
      const payload = await buildBrowserPayload(result, current.root, current.permissionMode);
      await interaction.reply({ content: `폴더를 생성했습니다: \`${result}\``, ...payload, ephemeral: true });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const detail = (err as NodeJS.ErrnoException)?.code === 'EEXIST' ? '이미 존재하는 폴더입니다.' : reason;
      await interaction.reply({ content: `폴더 생성에 실패했습니다: ${detail}`, ephemeral: true });
    }
    return true;
  }

  if (interaction.isStringSelectMenu()) {
    const [, selectAction, permToken] = interaction.customId.split(':');
    if (selectAction === 'permselect') {
      const current = pathTokens.get(permToken ?? '');
      if (!current) {
        await interaction.reply({ content: '브라우저 상태가 만료되었습니다. `/cdb browse`를 다시 실행해주세요.', ephemeral: true });
        return true;
      }
      const nextMode = interaction.values[0];
      if (!nextMode || !isSelectablePermissionMode(nextMode)) {
        await interaction.reply({ content: '알 수 없는 권한 모드입니다.', ephemeral: true });
        return true;
      }
      await interaction.update(await buildBrowserPayload(current.path, current.root, nextMode));
      return true;
    }
    const selected = pathTokens.get(interaction.values[0] ?? '');
    if (!selected) {
      await interaction.reply({ content: '선택한 경로가 만료되었습니다. `/cdb browse`를 다시 실행해주세요.', ephemeral: true });
      return true;
    }
    await interaction.update(await buildBrowserPayload(selected.path, selected.root, selected.permissionMode));
    return true;
  }

  const [, action, token] = interaction.customId.split(':');
  const current = pathTokens.get(token ?? '');
  if (!current) {
    await interaction.reply({ content: '브라우저 상태가 만료되었습니다. `/cdb browse`를 다시 실행해주세요.', ephemeral: true });
    return true;
  }

  if (action === 'up') {
    const parent = resolve(dirname(current.path));
    const next = isPathInsideRoot(parent, current.root) ? parent : current.root;
    await interaction.update(await buildBrowserPayload(next, current.root, current.permissionMode));
    return true;
  }

  if (action === 'mkdir') {
    await interaction.showModal(buildMkdirModal(token ?? ''));
    return true;
  }

  if (action?.startsWith('start-')) {
    await startSessionChannel(interaction, ctx, current.path, action.slice('start-'.length), current.permissionMode);
    return true;
  }

  return false;
}

async function buildBrowserPayload(cwd: string, root: string, permissionMode: string) {
  const dirs = await listDirectories(cwd);
  const currentToken = rememberPath(cwd, permissionMode, root);
  const embed = new EmbedBuilder()
    .setTitle('📁 작업 폴더 선택')
    .setDescription(`\`${cwd}\``)
    .setColor(0x5865f2)
    .addFields({ name: '권한 모드', value: permissionMode, inline: true });

  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];
  if (dirs.length > 0) {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${CUSTOM_PREFIX}:select`)
          .setPlaceholder('하위 폴더 선택')
          .addOptions(
            dirs.slice(0, 25).map((dir) => ({
              label: dir.name.slice(0, 100),
              value: rememberPath(dir.path, permissionMode, root),
              description: dir.path.slice(0, 100),
            })),
          ),
      ),
    );
  } else {
    embed.addFields({ name: '하위 폴더', value: '표시할 폴더가 없습니다.' });
  }

  rows.push(
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${CUSTOM_PREFIX}:permselect:${currentToken}`)
        .setPlaceholder(`권한 모드: ${permissionMode}`)
        .addOptions(
          PERMISSION_MODE_OPTIONS.map((opt) => ({
            label: opt.label,
            value: opt.value,
            description: opt.description,
            default: opt.value === permissionMode,
          })),
        ),
    ),
  );

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_PREFIX}:up:${currentToken}`)
        .setLabel('상위 폴더')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_PREFIX}:mkdir:${currentToken}`)
        .setLabel('폴더 생성')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_PREFIX}:start-sonnet:${currentToken}`)
        .setLabel('sonnet')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_PREFIX}:start-opus:${currentToken}`)
        .setLabel('opus')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${CUSTOM_PREFIX}:start-haiku:${currentToken}`)
        .setLabel('haiku')
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return { embeds: [embed], components: rows };
}

function buildMkdirModal(token: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${CUSTOM_PREFIX}:mkdir:${token}`)
    .setTitle('하위 폴더 생성')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('dirname')
          .setLabel('폴더 이름')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(80),
      ),
    );
}

async function createChildDirectory(parent: string, childName: string, root: string): Promise<string> {
  const safeName = sanitizeDirectoryName(childName);
  const target = resolve(parent, safeName);
  const parentResolved = resolve(parent);
  if (target === parentResolved || !isPathInsideRoot(target, parentResolved) || !isPathInsideRoot(target, root)) {
    throw new Error('잘못된 폴더 이름입니다.');
  }
  await mkdir(target, { recursive: false });
  return target;
}

async function listDirectories(cwd: string): Promise<Array<{ name: string; path: string }>> {
  const entries = await readdir(cwd, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({ name: e.name, path: join(cwd, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function startSessionChannel(
  interaction: ButtonInteraction,
  ctx: AppContext,
  cwd: string,
  model: string,
  permissionMode: string,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: '길드 내에서만 세션 채널을 만들 수 있습니다.', ephemeral: true });
    return;
  }

  const sessionsCat = interaction.guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildCategory && SESSIONS_CATEGORY_NAMES.includes(ch.name),
  );
  const rawName = basename(cwd) || 'session';
  const channelName = buildSessionChannelName(rawName);
  const meta = {
    sessionId: '',
    cwd,
    model,
    permissionMode,
    lastActiveAt: Date.now(),
  };

  const channel = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: sessionsCat?.id,
    topic: encodeTopic(meta),
  });
  await ctx.sessions.createSession(channel.id, { cwd, model, permissionMode });
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle('🆕 세션 채널 생성')
        .setDescription(`<#${channel.id}>`)
        .addFields(
          { name: 'cwd', value: cwd, inline: true },
          { name: 'model', value: model, inline: true },
          { name: 'permission', value: permissionMode, inline: true },
        )
        .setColor(0x57f287),
    ],
    components: [],
  });
}

function rememberPath(path: string, permissionMode: string, root: string): string {
  const token = randomBytes(9).toString('base64url');
  pathTokens.set(token, { path, permissionMode, root });
  return token;
}

export function sanitizeDirectoryName(name: string): string {
  const sanitized = name
    .replace(/[\\/]/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    throw new Error('잘못된 폴더 이름입니다.');
  }
  return sanitized;
}

export function buildSessionChannelName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9가-힣_-]+/gi, '-').replace(/^-+|-+$/g, '');
  return (slug || 'session').slice(0, 75);
}
