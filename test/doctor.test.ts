import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectDoctorChecks } from '../src/doctor.js';

describe('doctor', () => {
  it('reports missing env without hiding other checks', async () => {
    const checks = await collectDoctorChecks('/definitely/missing/.env');
    expect(checks.some((c) => c.name === '.env' && !c.ok)).toBe(true);
    expect(checks.some((c) => c.name === 'slash commands' && c.ok)).toBe(true);
  });

  it('validates required Discord env values when env exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cdb-doctor-'));
    const envPath = join(dir, '.env');
    await writeFile(envPath, 'DISCORD_TOKEN=t\nDISCORD_CLIENT_ID=c\nALLOWED_USER_IDS=u\n');

    const checks = await collectDoctorChecks(envPath);
    expect(checks.some((c) => c.name === 'env values' && c.ok)).toBe(true);
  });

  it('validates the full runtime config schema', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cdb-doctor-'));
    const envPath = join(dir, '.env');
    await writeFile(envPath, [
      'DISCORD_TOKEN=t',
      'DISCORD_CLIENT_ID=c',
      'ALLOWED_USER_IDS=u',
      'DEFAULT_MODEL=bad-model',
      '',
    ].join('\n'));

    const checks = await collectDoctorChecks(envPath);
    const envCheck = checks.find((c) => c.name === 'env values');
    expect(envCheck?.ok).toBe(false);
  });

  it('checks the configured CLAUDE_BIN instead of hardcoding claude', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cdb-doctor-'));
    const envPath = join(dir, '.env');
    await writeFile(envPath, [
      'DISCORD_TOKEN=t',
      'DISCORD_CLIENT_ID=c',
      'ALLOWED_USER_IDS=u',
      'CLAUDE_BIN=/definitely/missing/claude',
      '',
    ].join('\n'));

    const checks = await collectDoctorChecks(envPath);
    const claudeCheck = checks.find((c) => c.name === 'claude');
    expect(claudeCheck?.ok).toBe(false);
    expect(claudeCheck?.detail).toContain('/definitely/missing/claude');
  });
});
