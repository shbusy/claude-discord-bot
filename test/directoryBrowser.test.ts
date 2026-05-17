import { describe, expect, it } from 'vitest';
import { buildSessionChannelName, sanitizeDirectoryName } from '../src/ui/directoryBrowser.js';
import { resolveWithinRoot } from '../src/util/pathSecurity.js';

describe('directory browser', () => {
  it('sanitizes child directory names from modal input', () => {
    expect(sanitizeDirectoryName('feature/api')).toBe('feature-api');
    expect(sanitizeDirectoryName(' feature ')).toBe('feature');
  });

  it('rejects empty or parent-relative directory names', () => {
    expect(() => sanitizeDirectoryName('')).toThrow();
    expect(() => sanitizeDirectoryName('..')).toThrow();
  });

  it('builds Agent4Discord-prefixed session channel names', () => {
    expect(buildSessionChannelName('My Project')).toBe('a4d-my-project');
    expect(buildSessionChannelName('///')).toBe('a4d-session');
    expect(buildSessionChannelName('가나다')).toBe('a4d-가나다');
  });

  it('resolves relative paths under the configured workspace root', () => {
    expect(resolveWithinRoot('repo', '/work')).toBe('/work/repo');
    expect(resolveWithinRoot('/work/repo', '/work')).toBe('/work/repo');
    expect(() => resolveWithinRoot('/work-other/repo', '/work')).toThrow();
    expect(() => resolveWithinRoot('../etc', '/work')).toThrow();
  });
});
