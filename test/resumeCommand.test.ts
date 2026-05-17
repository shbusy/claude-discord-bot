import { describe, expect, it } from 'vitest';
import { resolveResumeTarget } from '../src/bot/commands/resume.js';
import type { SessionInfo } from '../src/claude/sessionStore.js';

describe('/a4d resume target resolution', () => {
  it('prefers the current channel topic session metadata', async () => {
    await expect(resolveResumeTarget({
      sessionId: 'topic-session',
      cwd: '/work/topic',
      model: 'sonnet',
      permissionMode: 'default',
      lastActiveAt: 1,
    }, '/work/default', async () => [])).resolves.toEqual({
      sessionId: 'topic-session',
      cwd: '/work/topic',
    });
  });

  it('falls back to the latest Claude JSONL session for the cwd', async () => {
    const sessions: SessionInfo[] = [
      { sessionId: 'latest', cwd: '/work/default', filePath: '/tmp/latest.jsonl', mtime: new Date(2) },
    ];

    await expect(resolveResumeTarget(undefined, '/work/default', async (cwd) => {
      expect(cwd).toBe('/work/default');
      return sessions;
    })).resolves.toEqual({
      sessionId: 'latest',
      cwd: '/work/default',
    });
  });

  it('returns null when no channel metadata or JSONL session exists', async () => {
    await expect(resolveResumeTarget(undefined, '/work/default', async () => [])).resolves.toBeNull();
  });
});
