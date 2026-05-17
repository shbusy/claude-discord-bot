import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  PRIMARY_BROWSER_CHANNEL_NAME,
  PRIMARY_SESSIONS_CATEGORY_NAME,
  PRIMARY_USAGE_CHANNEL_NAME,
} from '../src/bot/channelNames.js';
import { MANUAL_E2E_CHECKLIST } from '../src/e2eManual.js';

describe('manual e2e checklist', () => {
  it('is exposed through package scripts and CLI help documentation', async () => {
    const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { scripts: Record<string, string> };
    const bin = await readFile('bin/cdb.ts', 'utf8');

    expect(pkg.scripts['e2e:manual']).toBe('tsx bin/cdb.ts e2e-manual');
    expect(bin).toContain('cdb e2e-manual');
  });

  it('tracks the Agent4Discord-compatible channel names', () => {
    const text = MANUAL_E2E_CHECKLIST.join('\n');

    expect(text).toContain(`#${PRIMARY_BROWSER_CHANNEL_NAME}`);
    expect(text).toContain(`#${PRIMARY_USAGE_CHANNEL_NAME}`);
    expect(text).toContain(PRIMARY_SESSIONS_CATEGORY_NAME);
  });
});
