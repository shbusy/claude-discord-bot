import { REST, Routes } from 'discord.js';
import type { Config } from '../config/schema.js';
import type { Logger } from 'pino';
import { buildCdbCommand } from './commands/index.js';

export async function registerSlashCommands(cfg: Config, log: Logger): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(cfg.discordToken);
  const body = [buildCdbCommand().toJSON()];
  if (cfg.discordGuildId) {
    await rest.put(Routes.applicationGuildCommands(cfg.discordClientId, cfg.discordGuildId), { body });
    log.info({ guild: cfg.discordGuildId, count: body.length }, '길드 슬래시 커맨드 등록 완료');
  } else {
    await rest.put(Routes.applicationCommands(cfg.discordClientId), { body });
    log.info({ count: body.length }, '글로벌 슬래시 커맨드 등록 완료 (전파에 시간 소요)');
  }
}
