import { EmbedBuilder, type Message, type SendableChannels } from 'discord.js';
import type { UsageDelta } from '../claude/types.js';

const EMBED_DESC_LIMIT = 4096;
const FLUSH_DEBOUNCE_MS = 350;
const THINKING_TAIL_LINES = 3;
const THINKING_LINE_MAX_CHARS = 120;

interface ChunkSlot {
  msg: Message | null;
  text: string;
}

export interface StreamingMessageOptions {
  title?: string;
  color?: number;
  /** ms — debounce window for edits. Default 350ms (~3 edits/s). */
  debounceMs?: number;
  onFirstMessage?: (msg: Message) => void;
}

/**
 * Maintains one or more Discord messages whose embed description is
 * appended to incrementally. Splits on the 4096-char limit and reopens
 * fenced code blocks when crossing message boundaries.
 */
export class StreamingMessage {
  private slots: ChunkSlot[] = [{ msg: null, text: '' }];
  private thinking = '';
  private toolName: string | null = null;
  private usage: UsageDelta | null = null;
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private finalized = false;
  private readonly debounceMs: number;

  constructor(
    private readonly channel: SendableChannels,
    private readonly opts: StreamingMessageOptions = {},
  ) {
    this.debounceMs = opts.debounceMs ?? FLUSH_DEBOUNCE_MS;
  }

  appendText(s: string): void {
    if (s.length === 0) return;
    let remaining = s;
    while (remaining.length > 0) {
      const last = this.slots[this.slots.length - 1]!;
      const space = EMBED_DESC_LIMIT - last.text.length;
      if (space <= 0) {
        const carry = openFenceCarry(last.text);
        this.slots.push({ msg: null, text: carry });
        continue;
      }
      const take = remaining.slice(0, space);
      last.text += take;
      remaining = remaining.slice(space);
    }
    this.scheduleFlush();
  }

  appendThinking(s: string): void {
    if (s.length === 0) return;
    this.thinking = (this.thinking + s).slice(-1200);
    this.scheduleFlush();
  }

  setTool(name: string | null): void {
    this.toolName = name;
    this.scheduleFlush();
  }

  setUsage(u: UsageDelta): void {
    this.usage = u;
    this.scheduleFlush();
  }

  async finalize(): Promise<void> {
    this.finalized = true;
    this.thinking = '';
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // 진행 중인 flush가 있으면 완료될 때까지 대기 후 최종 flush
    while (this.flushing) {
      await new Promise<void>(r => setTimeout(r, 16));
    }
    await this.flushNow();
  }

  private scheduleFlush(): void {
    if (this.timer || this.finalized) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushNow();
    }, this.debounceMs);
  }

  private async flushNow(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (let i = 0; i < this.slots.length; i++) {
        const slot = this.slots[i]!;
        const isLast = i === this.slots.length - 1;
        const embed = this.buildEmbed(slot.text, isLast);
        if (slot.msg) {
          await slot.msg.edit({ embeds: [embed] });
        } else if (slot.text.length > 0 || isLast) {
          slot.msg = await this.channel.send({ embeds: [embed] });
          if (i === 0) this.opts.onFirstMessage?.(slot.msg);
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private buildEmbed(text: string, isLast: boolean): EmbedBuilder {
    const description = this.buildDescription(text, isLast);
    const e = new EmbedBuilder()
      .setColor(this.opts.color ?? 0x5865f2)
      .setDescription(description);
    if (this.opts.title) e.setTitle(this.opts.title);
    if (isLast) {
      const footer = buildFooter(this.toolName, this.usage, this.finalized);
      if (footer) e.setFooter({ text: footer });
    }
    return e;
  }

  private buildDescription(text: string, isLast: boolean): string {
    const base = text.length === 0 ? '⏳ 응답 대기 중…' : text;
    if (!isLast || this.thinking.length === 0) return base;
    const tail = tailThinkingLines(this.thinking);
    if (tail.length === 0) return base;
    const thinkingBlock = `\n\n> thinking\n\`\`\`\n${tail}\n\`\`\``;
    if (base.length + thinkingBlock.length > EMBED_DESC_LIMIT) return base.slice(0, EMBED_DESC_LIMIT);
    return base + thinkingBlock;
  }
}

export function tailThinkingLines(text: string): string {
  const lines = text.split('\n');
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
  const tail = lines.slice(-THINKING_TAIL_LINES).map((l) =>
    l.length > THINKING_LINE_MAX_CHARS ? '…' + l.slice(-(THINKING_LINE_MAX_CHARS - 1)) : l,
  );
  return tail.join('\n');
}

function buildFooter(tool: string | null, u: UsageDelta | null, done: boolean): string | null {
  const parts: string[] = [];
  if (tool) parts.push(`🛠 ${tool}`);
  if (u) {
    parts.push(`in ${u.inputTokens} / out ${u.outputTokens}`);
    if (typeof u.costUsd === 'number') parts.push(`$${u.costUsd.toFixed(4)}`);
  }
  parts.push(done ? '✅ done' : '… streaming');
  return parts.join(' • ');
}

/**
 * If `text` ends inside an unclosed fenced code block, returns
 * the trailing fence (and language) so it can be re-opened in the
 * next message. Otherwise returns ''.
 */
export function openFenceCarry(text: string): string {
  const lines = text.split('\n');
  let inFence = false;
  let lang = '';
  for (const line of lines) {
    const m = /^```(\S*)\s*$/.exec(line);
    if (m) {
      if (inFence) {
        inFence = false;
        lang = '';
      } else {
        inFence = true;
        lang = m[1] ?? '';
      }
    }
  }
  return inFence ? '```' + lang + '\n' : '';
}
