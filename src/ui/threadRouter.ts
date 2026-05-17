import {
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  type Message,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';

const MAX_DISCORD_ATTACHMENT_BYTES = 24 * 1024 * 1024;

/**
 * Routes tool-use events to per-tool Discord threads.
 * Each distinct tool call gets its own thread branching off the parent message.
 */
export class ThreadRouter {
  private readonly threads = new Map<string, ThreadChannel>();
  private parentMsg: Message | null = null;

  constructor(private readonly channel: TextChannel) {}

  /** Set the parent message (the bot's streaming response). */
  setParent(msg: Message): void {
    this.parentMsg = msg;
  }

  /**
   * Post a tool invocation to a thread. Creates the thread if needed.
   * Returns the thread for further updates.
   */
  async postToolUse(toolCallId: string, toolName: string, input: unknown): Promise<ThreadChannel> {
    let thread = this.threads.get(toolCallId);
    if (!thread) {
      thread = await this.createThread(toolCallId, toolName);
      this.threads.set(toolCallId, thread);
    }

    const inputStr = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
    const truncated = inputStr.length > 1800 ? inputStr.slice(0, 1800) + '\n…(truncated)' : inputStr;

    await thread.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(`🛠 ${toolName}`)
          .setDescription('```json\n' + truncated + '\n```')
          .setColor(0x5865f2),
      ],
    });

    return thread;
  }

  /**
   * Post tool result to an existing thread.
   */
  async postToolResult(toolCallId: string, result: string, files: string[] = []): Promise<void> {
    const thread = this.threads.get(toolCallId);
    if (!thread) return;

    const truncated = result.length > 3800 ? result.slice(0, 3800) + '\n…(truncated)' : result;
    const attachments = await existingFiles(files);
    await thread.send({
      embeds: [
        new EmbedBuilder()
          .setTitle('📤 결과')
          .setDescription('```\n' + truncated + '\n```')
          .setColor(0x57f287),
      ],
      files: attachments.map((file) => new AttachmentBuilder(file)),
    });
  }

  /** Clean up — archive all threads. */
  async finalize(): Promise<void> {
    for (const thread of this.threads.values()) {
      await thread.setArchived(true).catch(() => {});
    }
  }

  private async createThread(toolCallId: string, toolName: string): Promise<ThreadChannel> {
    const name = `🛠 ${toolName} (${toolCallId.slice(0, 8)})`;
    if (this.parentMsg && this.channel.type === ChannelType.GuildText) {
      return this.parentMsg.startThread({ name, autoArchiveDuration: 60 });
    }
    return this.channel.threads.create({
      name,
      autoArchiveDuration: 60,
      type: ChannelType.PublicThread,
    });
  }
}

export async function existingFiles(files: string[]): Promise<string[]> {
  const checked = await Promise.all(
    files.map(async (file) => {
      try {
        await access(file, constants.R_OK);
        const fileStat = await stat(file);
        return fileStat.isFile() && fileStat.size <= MAX_DISCORD_ATTACHMENT_BYTES ? file : null;
      } catch {
        return null;
      }
    }),
  );
  return checked.filter((file): file is string => file !== null);
}
