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
const SAFE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'TodoRead', 'TodoWrite']);

const SAFE_BASH_RE = /^\s*(git\s+(log|status|diff|show|ls-files|branch|tag|remote|describe|config\s+--list)\b|grep\b|rg\b|cat\b|head\b|tail\b|ls\b|find\b|which\b|file\b|stat\b|ps\b|wc\b|sort\b|uniq\b|echo\b|printf\b|jq\b)/;
const UNSAFE_BASH_RE = /\brm\s|\bmv\s|\bkill\b|\bpkill\b|\bchmod\b|\bchown\b|\bsudo\b|\bsu\s|git\s+(push|commit|reset|checkout|merge|rebase)\b|npm\s+(install|publish)\b|pip\s+(install|uninstall)\b|>{1}/;
const INPUT_PREVIEW_MAX_LINES = 3;
const INPUT_PREVIEW_MAX_LINE_CHARS = 120;

export interface PermissionState {
  lastMsg: Message | null;
}

export interface PermissionPromptOptions {
  timeoutMs?: number;
  state?: PermissionState;
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
  const state = opts?.state;

  // 이전 권한 요청 메시지 삭제 (단일 메시지 유지)
  if (state?.lastMsg) {
    await state.lastMsg.delete().catch(() => {});
    state.lastMsg = null;
  }

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
  if (state) state.lastMsg = msg;

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
    if (state) state.lastMsg = null;
    await collected.update({
      embeds: [embed.setColor(decision.decision === 'deny' ? 0xed4245 : 0x57f287)],
      components: [],
    });
    return decision;
  } catch {
    // Timeout — auto deny
    const decision: PermissionDecision = { type: 'permission_decision', id: req.id, decision: 'deny' };
    if (state) state.lastMsg = null;
    await msg.edit({
      embeds: [embed.setColor(0xed4245).setFooter({ text: '⏰ 타임아웃 — 자동 거부' })],
      components: [],
    }).catch(() => {});
    return decision;
  }
}

export function autoAllowSafeTool(req: PermissionRequestEvent): PermissionDecision | null {
  if (SAFE_TOOLS.has(req.tool.name)) {
    return { type: 'permission_decision', id: req.id, decision: 'allow_once' };
  }
  if (req.tool.name === 'Bash') {
    const cmd = typeof req.tool.input === 'object' && req.tool.input !== null
      ? String((req.tool.input as Record<string, unknown>).command ?? '')
      : '';
    if (cmd && SAFE_BASH_RE.test(cmd) && !UNSAFE_BASH_RE.test(cmd)) {
      return { type: 'permission_decision', id: req.id, decision: 'allow_once' };
    }
  }
  return null;
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
