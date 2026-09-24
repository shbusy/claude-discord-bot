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

const THREAD_NAME = '🛠 도구 로그';

/**
 * Routes tool-use events to a Discord thread hanging off the bot's response.
 *
 * Discord allows at most one thread per message, so all tool calls in a turn
 * share a single thread. Tool use/result pairs are posted as embeds inside it.
 */
export class ThreadRouter {
  /** Cached as a promise so concurrent tool events don't each create a thread. */
  private threadPromise: Promise<ThreadChannel> | null = null;
  /** Tool names by call id — used to label the matching result embed. */
  private readonly toolNames = new Map<string, string>();
  /** Serializes sends so a result never lands before its own invocation. */
  private sendQueue: Promise<unknown> = Promise.resolve();
  private parentMsg: Message | null = null;

  constructor(private readonly channel: TextChannel) {}

  /** Set the parent message (the bot's streaming response). */
  setParent(msg: Message): void {
    this.parentMsg = msg;
  }

  /**
   * Post a tool invocation to the turn's thread. Creates the thread if needed.
   * Returns the thread for further updates.
   */
  async postToolUse(toolCallId: string, toolName: string, input: unknown): Promise<ThreadChannel> {
    const thread = await this.ensureThread();
    this.toolNames.set(toolCallId, toolName);

    const inputStr = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
    const truncated = inputStr.length > 1800 ? inputStr.slice(0, 1800) + '\n…(truncated)' : inputStr;

    await this.enqueue(() =>
      thread.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(`🛠 ${toolName}`)
            .setDescription('```json\n' + truncated + '\n```')
            .setColor(0x5865f2),
        ],
      }),
    );

    return thread;
  }

  /**
   * Post a tool result. Ignored when the matching invocation was never posted
   * (e.g. AskUserQuestion, which renders in the channel instead).
   */
  async postToolResult(toolCallId: string, result: string, files: string[] = []): Promise<void> {
    if (!this.threadPromise || !this.toolNames.has(toolCallId)) return;
    const thread = await this.threadPromise;
    const toolName = this.toolNames.get(toolCallId);

    const truncated = result.length > 3800 ? result.slice(0, 3800) + '\n…(truncated)' : result;
    const attachments = await existingFiles(files);
    await this.enqueue(() =>
      thread.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(`📤 ${toolName} 결과`)
            .setDescription('```\n' + truncated + '\n```')
            .setColor(0x57f287),
        ],
        files: attachments.map((file) => new AttachmentBuilder(file)),
      }),
    );
  }

  /** Clean up — archive the thread. */
  async finalize(): Promise<void> {
    if (!this.threadPromise) return;
    const thread = await this.threadPromise.catch(() => null);
    await thread?.setArchived(true).catch(() => {});
  }

  private ensureThread(): Promise<ThreadChannel> {
    if (!this.threadPromise) {
      // 실패한 프로미스를 캐시에 남기면 이후 도구가 전부 조용히 죽으므로 비워서 재시도 가능하게 둔다.
      this.threadPromise = this.createThread().catch((err) => {
        this.threadPromise = null;
        throw err;
      });
    }
    return this.threadPromise;
  }

  private async createThread(): Promise<ThreadChannel> {
    if (this.parentMsg && this.channel.type === ChannelType.GuildText) {
      // 봇 재시작 등으로 이미 스레드가 붙은 메시지면 그걸 재사용한다.
      const existing = this.parentMsg.thread;
      if (existing) return existing;
      return this.parentMsg.startThread({ name: THREAD_NAME, autoArchiveDuration: 60 });
    }
    return this.channel.threads.create({
      name: THREAD_NAME,
      autoArchiveDuration: 60,
      type: ChannelType.PublicThread,
    });
  }

  private enqueue<T>(send: () => Promise<T>): Promise<T> {
    const next = this.sendQueue.then(send, send);
    this.sendQueue = next.catch(() => {});
    return next;
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
