import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { AppContext, SubCommand } from '../types.js';
import { statusCommand } from './status.js';
import { initCommand } from './init.js';
import { browseCommand } from './browse.js';
import { newCommand } from './new.js';
import { resumeCommand } from './resume.js';
import { modelCommand } from './model.js';
import { stopCommand } from './stop.js';
import { closeCommand } from './close.js';
import { usageCommand } from './usage.js';
import { pluginCommand } from './plugin.js';
import { configCommand } from './config.js';

const subcommands: SubCommand[] = [
  statusCommand,
  initCommand,
  browseCommand,
  newCommand,
  resumeCommand,
  modelCommand,
  stopCommand,
  closeCommand,
  usageCommand,
  pluginCommand,
  configCommand,
];

const byName = new Map<string, SubCommand>(subcommands.map((c) => [c.name, c]));

export function buildCdbCommand(): SlashCommandBuilder {
  return buildRootCommand('cdb');
}

export function buildA4dCommand(): SlashCommandBuilder {
  return buildRootCommand('a4d');
}

function buildRootCommand(name: 'cdb' | 'a4d'): SlashCommandBuilder {
  const cmd = new SlashCommandBuilder().setName(name).setDescription('Claude Code Discord Bot');
  for (const s of subcommands) {
    cmd.addSubcommand((sub) => s.build(sub));
  }
  return cmd;
}

export async function dispatch(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (interaction.commandName !== 'cdb' && interaction.commandName !== 'a4d') return;
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
    const msg = `❌ 처리 중 오류가 발생했습니다.`;
    ctx.log.debug({ errMsg: (err as Error).message }, '커맨드 에러 상세');
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
