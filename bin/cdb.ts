#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'),
) as { version: string };

const args = process.argv.slice(2);
const cmd = args[0];

async function main(): Promise<void> {
  if (cmd === '--version' || cmd === '-v') {
    process.stdout.write(`${pkg.version}\n`);
    return;
  }
  if (cmd === '--help' || cmd === '-h' || cmd === undefined || cmd === 'help') {
    printHelp();
    return;
  }
  if (cmd === 'run') {
    const { run } = await import('../src/index.js');
    await run();
    return;
  }
  if (cmd === 'register') {
    const { loadConfig } = await import('../src/config/load.js');
    const { createLogger } = await import('../src/util/logger.js');
    const { registerSlashCommands } = await import('../src/bot/register.js');
    const cfg = await loadConfig();
    await registerSlashCommands(cfg, createLogger());
    return;
  }
  process.stderr.write(`Unknown command: ${cmd}\n`);
  printHelp();
  process.exit(1);
}

function printHelp(): void {
  process.stdout.write(
    [
      'claude-discord-bot (cdb)',
      '',
      'Usage:',
      '  cdb run            봇 실행',
      '  cdb register       슬래시 커맨드 등록',
      '  cdb --version      버전 출력',
      '  cdb --help         도움말',
      '',
    ].join('\n'),
  );
}

main().catch((err: unknown) => {
  process.stderr.write(`fatal: ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});
