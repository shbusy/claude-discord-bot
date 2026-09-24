import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveExecutable } from '../src/util/resolveExecutable.js';

describe('resolveExecutable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cdb-bin-'));
  const exe = join(dir, 'fake-claude');
  writeFileSync(exe, '#!/bin/sh\n');
  chmodSync(exe, 0o755);

  it('finds a command on PATH', () => {
    expect(resolveExecutable('fake-claude', dir)).toBe(exe);
  });

  it('accepts an absolute executable path', () => {
    expect(resolveExecutable(exe, '')).toBe(exe);
  });

  it('returns null when missing', () => {
    expect(resolveExecutable('definitely-not-here-xyz', dir)).toBeNull();
    expect(resolveExecutable(join(dir, 'nope'), '')).toBeNull();
  });
});
