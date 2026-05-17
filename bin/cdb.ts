#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(findPackageJson(), 'utf8'),
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
    await run(args[1]);
    return;
  }
  if (cmd === 'setup' || cmd === '--setup') {
    const { runSetup } = await import('../src/setup.js');
    await runSetup(args[1]);
    return;
  }
  if (cmd === 'doctor') {
    const { runDoctor } = await import('../src/doctor.js');
    process.exitCode = await runDoctor(args[1]);
    return;
  }
  if (cmd === 'e2e-manual') {
    const { runManualE2EChecklist } = await import('../src/e2eManual.js');
    process.exitCode = await runManualE2EChecklist(args[1]);
    return;
  }
  if (cmd === 'register') {
    const { loadConfig } = await import('../src/config/load.js');
    const { createLogger } = await import('../src/util/logger.js');
    const { registerSlashCommands } = await import('../src/bot/register.js');
    const cfg = await loadConfig(args[1]);
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
      '  cdb setup [path]   .env 초기 설정 생성',
      '  cdb --setup        setup 별칭',
      '  cdb doctor [path]  로컬 실행 사전조건 점검',
      '  cdb e2e-manual [path] doctor 후 수동 Discord e2e 체크리스트 출력',
      '  cdb run [path]      봇 실행',
      '  cdb register [path] 슬래시 커맨드 등록',
      '  cdb --version      버전 출력',
      '  cdb --help         도움말',
      '',
    ].join('\n'),
  );
}

main().catch(async (err: unknown) => {
  const { formatConfigError } = await import('../src/config/load.js');
  const configMessage = formatConfigError(err);
  if (configMessage) {
    process.stderr.write(`${configMessage}\n`);
    process.exit(1);
  }
  process.stderr.write(`fatal: ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});

function findPackageJson(): string {
  const candidates = [
    resolve(__dirname, '..', 'package.json'),
    resolve(__dirname, '..', '..', 'package.json'),
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error('package.json not found');
  return found;
}
