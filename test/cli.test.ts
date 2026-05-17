import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('cdb CLI', () => {
  it('passes an explicit env path to doctor', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cdb-cli-'));
    const envPath = join(dir, '.env');
    await writeFile(envPath, [
      'DISCORD_TOKEN=t',
      'DISCORD_CLIENT_ID=c',
      'ALLOWED_USER_IDS=u',
      'DEFAULT_MODEL=sonnet',
      'PERMISSION_MODE=default',
      '',
    ].join('\n'));

    const { stdout } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', 'bin/cdb.ts', 'doctor', envPath],
      { cwd: process.cwd(), timeout: 10_000 },
    );

    expect(stdout).toContain(`OK .env: ${envPath}`);
    expect(stdout).toContain('OK env values: runtime config schema valid');
  });

  it('passes an explicit env path to e2e-manual before printing the checklist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cdb-cli-'));
    const envPath = join(dir, '.env');
    await writeFile(envPath, [
      'DISCORD_TOKEN=t',
      'DISCORD_CLIENT_ID=c',
      'ALLOWED_USER_IDS=u',
      'DEFAULT_MODEL=sonnet',
      'PERMISSION_MODE=default',
      '',
    ].join('\n'));

    const { stdout } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', 'bin/cdb.ts', 'e2e-manual', envPath],
      { cwd: process.cwd(), timeout: 10_000 },
    );

    expect(stdout).toContain(`OK .env: ${envPath}`);
    expect(stdout).toContain('Manual Discord e2e checklist:');
    expect(stdout).toContain('#a4d-session');
  });
});
