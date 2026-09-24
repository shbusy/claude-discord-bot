import { join } from 'node:path';
import { loadConfig, EXIT_CONFIG_ERROR } from './config/load.js';
import { createLogger } from './util/logger.js';
import { createClient } from './bot/client.js';
import { registerReady } from './bot/events/ready.js';
import { registerInteractions } from './bot/events/interactionCreate.js';
import { registerMessageCreate } from './bot/events/messageCreate.js';
import { SessionManager } from './session/manager.js';
import { PluginRegistry } from './plugins/registry.js';
import { PluginLoader } from './plugins/loader.js';
import { closeDb } from './usage/db.js';
import { resolveExecutable } from './util/resolveExecutable.js';
import type { AppContext } from './bot/types.js';

export async function run(envPath?: string): Promise<void> {
  const log = createLogger();
  const cfg = await loadConfig(envPath);

  if (cfg.allowedUserIds.length === 0) {
    log.error('ALLOWED_USER_IDS가 비어 있습니다. 보안상 부팅을 거부합니다.');
    process.exit(EXIT_CONFIG_ERROR);
  }

  // SDK에 번들된 Claude Code는 SDK 버전에 묶여 낡는다(모델 별칭 opus/sonnet도 옛 모델로 풀림).
  // 터미널에서 쓰는 것과 같은 설치본을 쓰도록 절대 경로로 확정해 넘긴다.
  const claudePath = resolveExecutable(cfg.claudeBin);
  if (claudePath) {
    cfg.claudeBin = claudePath;
    log.info({ claudeBin: claudePath }, 'Claude Code 실행 파일');
  } else {
    log.warn({ claudeBin: cfg.claudeBin }, 'CLAUDE_BIN을 찾지 못해 SDK 번들 Claude Code로 실행 (구버전일 수 있음)');
  }

  const client = createClient();
  const sessions = new SessionManager({ config: cfg, log });

  const pluginRegistry = new PluginRegistry();
  const pluginDir = join(cfg.cdbHome, 'plugins');
  const { discordToken: _token, ...pluginSafeConfig } = cfg;
  const pluginCtx = { client, config: pluginSafeConfig, log, sessions };
  const pluginLoader = new PluginLoader(pluginRegistry, pluginDir, pluginCtx, log);

  const ctx: AppContext = {
    client, config: cfg, log, startedAt: new Date(),
    sessions, pluginRegistry, pluginLoader,
  };

  registerReady(ctx);
  registerInteractions(ctx);
  registerMessageCreate(ctx);

  // 플러그인 로드 & 감시
  await pluginLoader.loadAll();
  pluginLoader.startWatching();

  const onShutdown = async (sig: string): Promise<void> => {
    log.info({ sig }, '종료 신호 수신, 정리 중');
    try {
      await pluginLoader.stopWatching();
      await pluginRegistry.unregisterAll();
      await sessions.shutdownAll();
      closeDb();
      client.destroy();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void onShutdown('SIGINT'));
  process.on('SIGTERM', () => void onShutdown('SIGTERM'));

  await client.login(cfg.discordToken);
}
