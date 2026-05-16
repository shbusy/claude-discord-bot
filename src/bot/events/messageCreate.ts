import { Events, type Message } from 'discord.js';
import type { AppContext } from '../types.js';
import { ClaudeRunner } from '../../claude/runner.js';
import { StreamingMessage } from '../../ui/streamingMessage.js';
import { homedir } from 'node:os';

/**
 * M2 단계: 봇이 멘션된 텍스트 채널에서 단일 메시지를 prompt로
 * 변환해 ClaudeRunner를 spawn 하고 결과를 임베드로 스트리밍한다.
 * M3에서 SessionManager로 대체된다.
 */
export function registerMessageCreate(ctx: AppContext): void {
  const inflight = new Map<string, ClaudeRunner>();

  ctx.client.on(Events.MessageCreate, (msg) => {
    void onMessage(msg, ctx, inflight).catch((err) => ctx.log.error({ err }, 'messageCreate 처리 실패'));
  });
}

async function onMessage(msg: Message, ctx: AppContext, inflight: Map<string, ClaudeRunner>): Promise<void> {
  if (msg.author.bot) return;
  if (!ctx.config.allowedUserIds.includes(msg.author.id)) return;
  if (!msg.channel.isSendable()) return;
  if (!ctx.client.user) return;
  const mentioned = msg.mentions.users.has(ctx.client.user.id);
  if (!mentioned) return;
  if (inflight.has(msg.channelId)) {
    await msg.reply('이전 응답이 아직 진행 중입니다. `/cdb stop` 후 재시도하세요.');
    return;
  }

  const prompt = stripMention(msg.content, ctx.client.user.id).trim();
  if (prompt.length === 0) {
    await msg.reply('프롬프트를 입력해주세요.');
    return;
  }

  const stream = new StreamingMessage(msg.channel, {
    title: `🤖 ${ctx.config.defaultModel}`,
    color: 0x5865f2,
  });

  const runner = new ClaudeRunner({
    bin: ctx.config.claudeBin,
    cwd: homedir(),
    model: ctx.config.defaultModel,
    initialPrompt: prompt,
  });
  inflight.set(msg.channelId, runner);

  runner.on('text', (delta) => stream.appendText(delta));
  runner.on('toolUse', (b) => stream.setTool(b.name));
  runner.on('usage', (u) => stream.setUsage(u));
  runner.on('error', (err) => {
    ctx.log.error({ err }, 'runner 에러');
    stream.appendText(`\n❌ ${err.message}`);
  });
  runner.on('end', () => {
    runner.endInput();
    void stream.finalize();
  });
  runner.on('exit', () => {
    inflight.delete(msg.channelId);
  });

  try {
    await runner.start();
  } catch (err) {
    inflight.delete(msg.channelId);
    ctx.log.error({ err }, 'runner 시작 실패');
    await msg.reply(`runner 시작 실패: ${(err as Error).message}`);
  }
}

function stripMention(content: string, botId: string): string {
  return content.replace(new RegExp(`<@!?${botId}>`, 'g'), '');
}
