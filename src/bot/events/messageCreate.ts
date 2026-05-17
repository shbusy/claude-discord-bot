import { EmbedBuilder, Events, type Message, type SendableChannels, type TextChannel, ChannelType } from 'discord.js';
import type { AppContext } from '../types.js';
import { StreamingMessage } from '../../ui/streamingMessage.js';
import { showPermissionPrompt } from '../../ui/permissionPrompt.js';
import { ThreadRouter } from '../../ui/threadRouter.js';
import { UsageTracker } from '../../usage/tracker.js';
import {
  extractOutputFilePath,
  formatAttachmentsForPrompt,
  saveMessageAttachments,
  shouldAttachOutputFile,
} from '../../util/attachments.js';
import type { UsageDelta } from '../../claude/types.js';
import { USAGE_CHANNEL_NAMES } from '../channelNames.js';

export function registerMessageCreate(ctx: AppContext): void {
  ctx.client.on(Events.MessageCreate, (msg) => {
    void onMessage(msg, ctx).catch((err) => ctx.log.error({ err }, 'messageCreate 처리 실패'));
  });
}

async function onMessage(msg: Message, ctx: AppContext): Promise<void> {
  if (msg.author.bot) return;
  if (!ctx.config.allowedUserIds.includes(msg.author.id)) return;
  if (!msg.channel.isSendable()) return;
  if (!ctx.client.user) return;
  const mentioned = msg.mentions.users.has(ctx.client.user.id);
  if (!mentioned) return;
  if (ctx.pluginRegistry && await ctx.pluginRegistry.runUserMessageHooks(msg, ctx)) return;

  if (ctx.sessions.hasActiveRunner(msg.channelId)) {
    await msg.reply('이전 응답이 아직 진행 중입니다. `/cdb stop` 후 재시도하세요.');
    return;
  }

  const prompt = await buildPrompt(msg, ctx);
  if (prompt.length === 0) {
    await msg.reply('프롬프트를 입력해주세요.');
    return;
  }

  // 재시작 후 토픽에서 세션 메타데이터 복원
  if (!ctx.sessions.get(msg.channelId) && msg.channel.type === ChannelType.GuildText) {
    const topic = (msg.channel as TextChannel).topic;
    ctx.sessions.restoreFromTopic(msg.channelId, topic);
  }
  const session = ctx.sessions.get(msg.channelId);
  const isGuildText = msg.channel.type === ChannelType.GuildText;
  const threadRouter = isGuildText ? new ThreadRouter(msg.channel as TextChannel) : null;
  const stream = new StreamingMessage(msg.channel, {
    title: `🤖 ${session?.meta.model ?? ctx.config.defaultModel}`,
    color: 0x5865f2,
    onFirstMessage: (firstMsg) => threadRouter?.setParent(firstMsg),
  });

  const tracker = new UsageTracker(ctx.config.cdbHome, {
    sessionId: session?.meta.sessionId ?? '',
    channelId: msg.channelId,
    userId: msg.author.id,
    model: session?.meta.model ?? ctx.config.defaultModel,
  });
  const turnUsage = createEmptyUsage();
  const outputFiles = new Map<string, string>();
  let lastRateLimit: unknown = null;

  await ctx.sessions.send(msg.channelId, prompt, {
    onText: (delta) => stream.appendText(delta),
    onThinking: (delta) => stream.appendThinking(delta),
    onToolUse: (b) => {
      stream.setTool(b.name);
      const current = ctx.sessions.get(msg.channelId);
      const outputFile = extractOutputFilePath(b.name, b.input, current?.meta.cwd ?? ctx.config.defaultCwd);
      if (outputFile) outputFiles.set(b.id, outputFile);
      if (threadRouter) {
        void threadRouter.postToolUse(b.id, b.name, b.input).catch((err) =>
          ctx.log.warn({ err }, '도구 스레드 생성 실패'),
        );
      }
    },
    onToolResult: (b) => {
      if (threadRouter) {
        const file = outputFiles.get(b.toolUseId);
        const current = ctx.sessions.get(msg.channelId);
        const files = file && current && !b.isError && shouldAttachOutputFile(file, current.meta.cwd) ? [file] : [];
        void threadRouter.postToolResult(b.toolUseId, b.content, files).catch((err) =>
          ctx.log.warn({ err }, '도구 결과 게시 실패'),
        );
      }
      if (b.isError) stream.setTool('tool error');
    },
    onUsage: (u) => {
      stream.setUsage(u);
      tracker.record(u);
      addUsage(turnUsage, u);
    },
    onRateLimit: (info) => {
      lastRateLimit = info;
      stream.appendText(`\n\nRate limit: \`${formatRateLimit(info)}\``);
    },
    onError: (err) => {
      ctx.log.error({ err }, 'runner 에러');
      stream.appendText(`\n❌ ${err.message}`);
    },
    onEnd: () => {
      // 세션 ID가 init 이벤트에서 갱신됐을 수 있음
      const current = ctx.sessions.get(msg.channelId);
      if (current?.meta.sessionId) {
        tracker.updateSessionId(current.meta.sessionId);
        tracker.flush();
      }

      void stream.finalize().then(async () => {
        if (threadRouter) {
          await threadRouter.finalize().catch(() => {});
        }
        if (isGuildText) {
          void ctx.sessions.syncTopic(msg.channel as TextChannel).catch((err) =>
            ctx.log.warn({ err }, '토픽 동기화 실패'),
          );
          void postUsageUpdate(msg.channel as TextChannel, turnUsage, lastRateLimit).catch((err) =>
            ctx.log.warn({ err }, '사용량 채널 업데이트 실패'),
          );
        }
        void msg.reply({ content: `<@${msg.author.id}> 응답이 완료되었습니다.` }).catch(() => {});
      });
    },
    onPermission: (req) => showPermissionPrompt(msg.channel as SendableChannels, req, ctx.config.allowedUserIds),
  });
}

function stripMention(content: string, botId: string): string {
  return content.replace(new RegExp(`<@!?${botId}>`, 'g'), '');
}

async function buildPrompt(msg: Message, ctx: AppContext): Promise<string> {
  const text = stripMention(msg.content, ctx.client.user!.id).trim();
  try {
    const attachments = await saveMessageAttachments(msg, ctx.config.cdbHome);
    return [text, formatAttachmentsForPrompt(attachments)].filter((s) => s.length > 0).join('\n\n');
  } catch (err) {
    ctx.log.warn({ err, messageId: msg.id }, '첨부 파일 저장 실패');
    const fallback = `첨부 파일 저장에 실패했습니다: ${(err as Error).message}`;
    return [text, fallback].filter((s) => s.length > 0).join('\n\n');
  }
}

function formatRateLimit(info: unknown): string {
  if (!info || typeof info !== 'object') return String(info);
  const i = info as { status?: unknown; rateLimitType?: unknown; utilization?: unknown; resetsAt?: unknown };
  return [
    typeof i.status === 'string' ? i.status : undefined,
    typeof i.rateLimitType === 'string' ? i.rateLimitType : undefined,
    typeof i.utilization === 'number' ? `${Math.round(i.utilization * 100)}%` : undefined,
    typeof i.resetsAt === 'number' ? `reset ${new Date(i.resetsAt).toISOString()}` : undefined,
  ].filter(Boolean).join(' ');
}

function createEmptyUsage(): UsageDelta {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    costUsd: undefined,
  };
}

function addUsage(target: UsageDelta, delta: UsageDelta): void {
  if (delta.final) {
    target.inputTokens = delta.inputTokens;
    target.outputTokens = delta.outputTokens;
    target.cacheCreationInputTokens = delta.cacheCreationInputTokens ?? 0;
    target.cacheReadInputTokens = delta.cacheReadInputTokens ?? 0;
    target.costUsd = delta.costUsd;
    target.final = true;
    return;
  }
  target.inputTokens += delta.inputTokens;
  target.outputTokens += delta.outputTokens;
  target.cacheCreationInputTokens = (target.cacheCreationInputTokens ?? 0) + (delta.cacheCreationInputTokens ?? 0);
  target.cacheReadInputTokens = (target.cacheReadInputTokens ?? 0) + (delta.cacheReadInputTokens ?? 0);
  if (typeof delta.costUsd === 'number') target.costUsd = delta.costUsd;
}

export async function postUsageUpdate(channel: TextChannel, usage: UsageDelta, rateLimit: unknown): Promise<void> {
  if (usage.inputTokens === 0 && usage.outputTokens === 0 && !rateLimit) return;
  const usageChannel = channel.guild.channels.cache.find(
    (ch) => ch.type === ChannelType.GuildText && USAGE_CHANNEL_NAMES.includes(ch.name),
  ) as TextChannel | undefined;
  if (!usageChannel) return;
  const embed = new EmbedBuilder()
    .setTitle('📊 세션 사용량')
    .setColor(0x5865f2)
    .addFields(
      { name: '채널', value: `<#${channel.id}>`, inline: true },
      { name: 'Input', value: usage.inputTokens.toLocaleString(), inline: true },
      { name: 'Output', value: usage.outputTokens.toLocaleString(), inline: true },
    )
    .setTimestamp(new Date());
  if (typeof usage.costUsd === 'number') {
    embed.addFields({ name: 'Cost', value: `$${usage.costUsd.toFixed(4)}`, inline: true });
  }
  if (rateLimit) {
    embed.addFields({ name: 'Rate limit', value: formatRateLimit(rateLimit) || 'unknown' });
  }
  await usageChannel.send({ embeds: [embed] });
}
