import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { buildCdbCommand } from './bot/commands/index.js';
import { ConfigSchema } from './config/schema.js';
import { defaultCdbHome } from './config/defaults.js';

const execFileAsync = promisify(execFile);

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export async function runDoctor(envPath = resolve(process.cwd(), '.env')): Promise<number> {
  const checks = await collectDoctorChecks(envPath);
  for (const check of checks) {
    process.stdout.write(`${check.ok ? 'OK' : 'FAIL'} ${check.name}: ${check.detail}\n`);
  }
  return checks.every((c) => c.ok) ? 0 : 1;
}

export async function collectDoctorChecks(envPath: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const envExists = await access(envPath, constants.R_OK).then(() => true, () => false);
  let parsedEnv: Record<string, string> = {};
  checks.push({
    name: '.env',
    ok: envExists,
    detail: envExists ? envPath : `${envPath} not found; run cdb setup`,
  });
  if (envExists) {
    parsedEnv = parseDotenv(await readFile(envPath));
    checks.push(checkEnvValues(parsedEnv));
  }

  checks.push(await checkClaude(parsedEnv.CLAUDE_BIN || 'claude'));

  const commands = [buildCdbCommand().toJSON()];
  const commandNames = commands.map((cmd) => cmd.name);
  const subcommandNames = commands.flatMap((command) => (command.options ?? []).map((o) => o.name));
  checks.push({
    name: 'slash commands',
    ok:
      commandNames.includes('cdb') &&
      ['init', 'browse', 'resume', 'model', 'close'].every((name) => subcommandNames.includes(name)),
    detail: commands.map((cmd) => `/${cmd.name}: ${(cmd.options ?? []).map((o) => o.name).join(', ')}`).join(' | '),
  });

  return checks;
}

function checkEnvValues(parsed: Record<string, string>): DoctorCheck {
  const result = ConfigSchema.safeParse({
    discordToken: parsed.DISCORD_TOKEN ?? '',
    discordClientId: parsed.DISCORD_CLIENT_ID ?? '',
    discordGuildId: parsed.DISCORD_GUILD_ID || undefined,
    allowedUserIds: splitCsv(parsed.ALLOWED_USER_IDS),
    claudeBin: parsed.CLAUDE_BIN || 'claude',
    defaultModel: parsed.DEFAULT_MODEL || 'sonnet',
    permissionMode: parsed.PERMISSION_MODE || 'default',
    defaultLang: parsed.DEFAULT_LANG || 'ko',
    defaultCwd: parsed.DEFAULT_CWD || homedir(),
    cdbHome: parsed.CDB_HOME || defaultCdbHome(),
    logLevel: parsed.LOG_LEVEL || 'info',
    idleTimeoutMs: parsed.IDLE_TIMEOUT_MS ? Number(parsed.IDLE_TIMEOUT_MS) : undefined,
  });
  return {
    name: 'env values',
    ok: result.success,
    detail: result.success
      ? 'runtime config schema valid'
      : result.error.issues.map((issue) => issue.message).join('; '),
  };
}

function splitCsv(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function checkClaude(bin: string): Promise<DoctorCheck> {
  try {
    const { stdout } = await execFileAsync(bin, ['--version'], { timeout: 5000 });
    return { name: 'claude', ok: true, detail: stdout.trim() || 'installed' };
  } catch (err) {
    return { name: 'claude', ok: false, detail: (err as Error).message };
  }
}
