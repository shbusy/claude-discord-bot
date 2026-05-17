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

  it('builds session channel names from directory name', () => {
    expect(buildSessionChannelName('My Project')).toBe('my-project');
    expect(buildSessionChannelName('///')).toBe('session');
    expect(buildSessionChannelName('가나다')).toBe('가나다');
  });

  it('resolves relative paths under the configured workspace root', () => {
    expect(resolveWithinRoot('repo', '/work')).toBe('/work/repo');
    expect(resolveWithinRoot('/work/repo', '/work')).toBe('/work/repo');
    expect(() => resolveWithinRoot('/work-other/repo', '/work')).toThrow();
    expect(() => resolveWithinRoot('../etc', '/work')).toThrow();
  });
});
