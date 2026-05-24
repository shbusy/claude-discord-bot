import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  type Message,
  type SendableChannels,
} from 'discord.js';
import type {
  AskUserQuestionAnswer,
  AskUserQuestionEvent,
  AskUserQuestionItem,
} from '../claude/types.js';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MODAL_TIMEOUT_MS = 5 * 60 * 1000;
const BUTTON_LABEL_MAX = 80;
const SELECT_LABEL_MAX = 100;
const SELECT_DESC_MAX = 100;
const MODAL_INPUT_MAX = 4000;

/**
 * Show one Discord message per question and collect the user's choice(s).
 * Returns the aggregated AskUserQuestionAnswer, marking `interrupted: true`
 * if any prompt times out or the user explicitly cancels.
 */
export async function showAskUserQuestion(
  channel: SendableChannels,
  req: AskUserQuestionEvent,
  allowedUserIds: string[],
  opts?: { timeoutMs?: number },
): Promise<AskUserQuestionAnswer> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const answers: { [question: string]: string } = {};

  for (let i = 0; i < req.questions.length; i++) {
    const q = req.questions[i]!;
    const answer = await promptOne(channel, q, i, req.questions.length, allowedUserIds, timeoutMs);
    if (answer === null) {
      return { type: 'ask_user_question_answer', id: req.id, answers, interrupted: true };
    }
    answers[q.question] = answer;
  }

  return { type: 'ask_user_question_answer', id: req.id, answers, interrupted: false };
}

async function promptOne(
  channel: SendableChannels,
  q: AskUserQuestionItem,
  index: number,
  total: number,
  allowedUserIds: string[],
  timeoutMs: number,
): Promise<string | null> {
  const header = total > 1 ? `❓ ${q.header} (${index + 1}/${total})` : `❓ ${q.header}`;
  const embed = new EmbedBuilder()
    .setTitle(header)
    .setColor(0x5865f2)
    .setDescription(q.question)
    .setFooter({ text: `${Math.round(timeoutMs / 1000 / 60)}분 내 응답 없으면 중단` });

  if (!q.multiSelect) {
    appendOptionsField(embed, q.options);
  }

  const components = q.multiSelect ? buildMultiSelectRows(q) : buildSingleSelectRows(q);
  const msg = await channel.send({ embeds: [embed], components });

  try {
    const result = q.multiSelect
      ? await waitMultiSelect(msg, q, allowedUserIds, timeoutMs)
      : await waitSingleSelect(msg, q, allowedUserIds, timeoutMs);
    if (result === null) {
      await finalizeMsg(msg, embed, '⏹ 사용자가 취소했습니다.');
      return null;
    }
    await finalizeMsg(msg, embed, `✅ ${result}`);
    return result;
  } catch {
    await finalizeMsg(msg, embed, '⏰ 응답 시간 초과 — 중단합니다.');
    return null;
  }
}

function buildSingleSelectRows(q: AskUserQuestionItem): ActionRowBuilder<ButtonBuilder>[] {
  const buttons = q.options.map((opt, i) =>
    new ButtonBuilder()
      .setCustomId(`aq_opt_${i}`)
      .setLabel(truncate(opt.label, BUTTON_LABEL_MAX))
      .setStyle(ButtonStyle.Primary),
  );
  buttons.push(
    new ButtonBuilder()
      .setCustomId('aq_other')
      .setLabel('기타 (직접 입력)')
      .setStyle(ButtonStyle.Secondary),
  );
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
  return [row];
}

function buildMultiSelectRows(
  q: AskUserQuestionItem,
): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const select = new StringSelectMenuBuilder()
    .setCustomId('aq_select')
    .setPlaceholder('하나 이상 선택')
    .setMinValues(1)
    .setMaxValues(q.options.length)
    .addOptions(
      q.options.map((opt, i) => ({
        label: truncate(opt.label, SELECT_LABEL_MAX),
        description: opt.description ? truncate(opt.description, SELECT_DESC_MAX) : undefined,
        value: String(i),
      })),
    );
  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('aq_other').setLabel('기타 (직접 입력)').setStyle(ButtonStyle.Secondary),
  );
  return [selectRow, buttonRow];
}

async function waitSingleSelect(
  msg: Message,
  q: AskUserQuestionItem,
  allowedUserIds: string[],
  timeoutMs: number,
): Promise<string | null> {
  const interaction = await msg.awaitMessageComponent({
    componentType: ComponentType.Button,
    filter: (i) => allowedUserIds.includes(i.user.id),
    time: timeoutMs,
  });

  if (interaction.customId === 'aq_other') {
    return collectViaModal(interaction, q);
  }

  const match = /^aq_opt_(\d+)$/.exec(interaction.customId);
  if (!match) {
    await interaction.deferUpdate().catch(() => {});
    return null;
  }
  const idx = Number(match[1]);
  const opt = q.options[idx];
  if (!opt) {
    await interaction.deferUpdate().catch(() => {});
    return null;
  }
  await interaction.deferUpdate().catch(() => {});
  return opt.label;
}

async function waitMultiSelect(
  msg: Message,
  q: AskUserQuestionItem,
  allowedUserIds: string[],
  timeoutMs: number,
): Promise<string | null> {
  const interaction = await msg.awaitMessageComponent({
    filter: (i) => allowedUserIds.includes(i.user.id),
    time: timeoutMs,
  });

  if (interaction.isButton() && interaction.customId === 'aq_other') {
    return collectViaModal(interaction, q);
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'aq_select') {
    const labels = interaction.values
      .map((v) => q.options[Number(v)]?.label)
      .filter((s): s is string => Boolean(s));
    await interaction.deferUpdate().catch(() => {});
    if (labels.length === 0) return null;
    return labels.join(', ');
  }

  await interaction.deferUpdate().catch(() => {});
  return null;
}

async function collectViaModal(
  interaction: ButtonInteraction,
  q: AskUserQuestionItem,
): Promise<string | null> {
  const modalId = `aq_modal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(truncate(`기타: ${q.header}`, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('aq_other_text')
          .setLabel(truncate(q.question, 45))
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(MODAL_INPUT_MAX)
          .setRequired(true),
      ),
    );

  await interaction.showModal(modal);

  try {
    const submitted: ModalSubmitInteraction = await interaction.awaitModalSubmit({
      filter: (i) => i.customId === modalId && i.user.id === interaction.user.id,
      time: MODAL_TIMEOUT_MS,
    });
    const text = submitted.fields.getTextInputValue('aq_other_text').trim();
    await submitted.deferUpdate().catch(() => {});
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

function appendOptionsField(embed: EmbedBuilder, options: AskUserQuestionItem['options']): void {
  const lines = options.map((opt, i) => {
    const desc = opt.description ? ` — ${opt.description}` : '';
    return `**${i + 1}. ${opt.label}**${desc}`;
  });
  embed.addFields({ name: '선택지', value: truncate(lines.join('\n'), 1024) });
}

async function finalizeMsg(msg: Message, embed: EmbedBuilder, footer: string): Promise<void> {
  const finalEmbed = EmbedBuilder.from(embed).setFooter({ text: footer });
  await msg.edit({ embeds: [finalEmbed], components: [] }).catch(() => {});
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
