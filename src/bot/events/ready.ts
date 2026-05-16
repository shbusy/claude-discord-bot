import { Events } from 'discord.js';
import type { AppContext } from '../types.js';

export function registerReady(ctx: AppContext): void {
  ctx.client.once(Events.ClientReady, (c) => {
    ctx.log.info({ tag: c.user.tag, id: c.user.id }, '✅ Discord 로그인 완료');
  });
}
