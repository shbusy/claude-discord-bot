import { loadConfig } from './config/load.js';
import { createLogger } from './util/logger.js';
import { createClient } from './bot/client.js';
import { registerReady } from './bot/events/ready.js';
import { registerInteractions } from './bot/events/interactionCreate.js';
import { registerMessageCreate } from './bot/events/messageCreate.js';
import type { AppContext } from './bot/types.js';

export async function run(): Promise<void> {
  const log = createLogger();
  const cfg = await loadConfig();

  if (cfg.allowedUserIds.length === 0) {
    log.error('ALLOWED_USER_IDS가 비어 있습니다. 보안상 부팅을 거부합니다.');
    process.exit(1);
  }

  const client = createClient();
  const ctx: AppContext = { client, config: cfg, log, startedAt: new Date() };

  registerReady(ctx);
  registerInteractions(ctx);
  registerMessageCreate(ctx);

  const onShutdown = async (sig: string): Promise<void> => {
    log.info({ sig }, '종료 신호 수신, 정리 중');
    try {
      client.destroy();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void onShutdown('SIGINT'));
  process.on('SIGTERM', () => void onShutdown('SIGTERM'));

  await client.login(cfg.discordToken);
}
