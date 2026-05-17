import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type SendableChannels,
  type Message,
  type ButtonInteraction,
  ComponentType,
} from 'discord.js';
import type { PermissionRequestEvent, PermissionDecision } from '../claude/types.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const SAFE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'TodoRead']);
const INPUT_PREVIEW_MAX_LINES = 3;
const INPUT_PREVIEW_MAX_LINE_CHARS = 120;

export interface PermissionPromptOptions {
  timeoutMs?: number;
}

export interface PermissionPromptResult {
  decision: PermissionDecision;
  interaction: ButtonInteraction;
}

/**
 * Display a permission request prompt with approve/deny/once buttons.
 * Returns the user's decision or auto-denies on timeout.
 */
export async function showPermissionPrompt(
  channel: SendableChannels,
  req: PermissionRequestEvent,
  allowedUserIds: string[],
  opts?: PermissionPromptOptions,
): Promise<PermissionDecision> {
  const autoDecision = autoAllowSafeTool(req);
  if (autoDecision) return autoDecision;

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const embed = new EmbedBuilder()
    .setTitle('🔐 도구 사용 권한 요청')
    .setColor(0xfee75c)
    .addFields(
      { name: 'Tool', value: req.tool.name, inline: true },
      { name: 'Risk', value: req.risk ?? 'unknown', inline: true },
    )
    .setDescription('```json\n' + formatInputPreview(req.tool.input) + '\n```')
    .setFooter({ text: `${Math.round(timeoutMs / 1000)}초 내 응답 없으면 자동 거부` });

  const row = buildPermissionButtonRow(req.id);

  const msg: Message = await channel.send({ embeds: [embed], components: [row] });

  try {
    const collected = await msg.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) =>
        i.customId.startsWith('perm_') &&
        i.customId.endsWith(req.id) &&
        allowedUserIds.includes(i.user.id),
      time: timeoutMs,
    });

    const decision = parseDecision(collected.customId, req.id);
    await collected.update({
      embeds: [embed.setColor(decision.decision === 'deny' ? 0xed4245 : 0x57f287)],
      components: [],
    });
    return decision;
  } catch {
    // Timeout — auto deny
    const decision: PermissionDecision = { type: 'permission_decision', id: req.id, decision: 'deny' };
    await msg.edit({
      embeds: [embed.setColor(0xed4245).setFooter({ text: '⏰ 타임아웃 — 자동 거부' })],
      components: [],
    }).catch(() => {});
    return decision;
  }
}

export function autoAllowSafeTool(req: PermissionRequestEvent): PermissionDecision | null {
  if (!SAFE_TOOLS.has(req.tool.name)) return null;
  return { type: 'permission_decision', id: req.id, decision: 'allow_once' };
}

export function buildPermissionButtonRow(reqId: string): ActionRowBuilder<ButtonBuilder> {
  const onceBtn = new ButtonBuilder()
    .setCustomId(`perm_once_${reqId}`)
    .setLabel('한 번만 허용')
    .setStyle(ButtonStyle.Primary);

  const approveBtn = new ButtonBuilder()
    .setCustomId(`perm_allow_${reqId}`)
    .setLabel('항상 허용')
    .setStyle(ButtonStyle.Success);

  const denyBtn = new ButtonBuilder()
    .setCustomId(`perm_deny_${reqId}`)
    .setLabel('거부')
    .setStyle(ButtonStyle.Danger);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(onceBtn, approveBtn, denyBtn);
}

export function formatInputPreview(input: unknown): string {
  const pretty = JSON.stringify(input, null, 2) ?? '';
  const lines = pretty.split('\n');
  const shown = lines.slice(0, INPUT_PREVIEW_MAX_LINES).map(truncateLine);
  const hiddenLines = lines.length - INPUT_PREVIEW_MAX_LINES;
  if (hiddenLines > 0) shown.push(`… (+${hiddenLines} more)`);
  return shown.join('\n');
}

function truncateLine(line: string): string {
  if (line.length <= INPUT_PREVIEW_MAX_LINE_CHARS) return line;
  return line.slice(0, INPUT_PREVIEW_MAX_LINE_CHARS - 1) + '…';
}

function parseDecision(customId: string, reqId: string): PermissionDecision {
  if (customId === `perm_allow_${reqId}`) {
    return { type: 'permission_decision', id: reqId, decision: 'allow' };
  }
  if (customId === `perm_once_${reqId}`) {
    return { type: 'permission_decision', id: reqId, decision: 'allow_once' };
  }
  return { type: 'permission_decision', id: reqId, decision: 'deny' };
}
