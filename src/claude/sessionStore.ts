import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface SessionInfo {
  sessionId: string;
  cwd: string;
  filePath: string;
  mtime: Date;
}

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');

/**
 * Encode a cwd path to the directory name Claude Code uses under ~/.claude/projects/.
 * Claude encodes the path by replacing '/' with '-' and prepending '-'.
 */
export function encodeCwd(cwd: string): string {
  return '-' + cwd.replace(/\//g, '-');
}

/**
 * Check if a session JSONL file exists for the given sessionId.
 * Searches all project directories.
 */
export async function findSession(sessionId: string): Promise<SessionInfo | null> {
  try {
    const dirs = await readdir(CLAUDE_PROJECTS_DIR);
    for (const dir of dirs) {
      const dirPath = join(CLAUDE_PROJECTS_DIR, dir);
      const dirStat = await stat(dirPath).catch(() => null);
      if (!dirStat?.isDirectory()) continue;
      const sessionFile = join(dirPath, `${sessionId}.jsonl`);
      const fileStat = await stat(sessionFile).catch(() => null);
      if (fileStat?.isFile()) {
        const cwd = decodeDirName(dir);
        return { sessionId, cwd, filePath: sessionFile, mtime: fileStat.mtime };
      }
    }
  } catch {
    // ~/.claude/projects/ may not exist
  }
  return null;
}

/**
 * List sessions for a specific cwd, sorted by most recent first.
 */
export async function listSessions(cwd: string): Promise<SessionInfo[]> {
  const encoded = encodeCwd(cwd);
  const dirPath = join(CLAUDE_PROJECTS_DIR, encoded);
  try {
    const files = await readdir(dirPath);
    const sessions: SessionInfo[] = [];
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const sessionId = file.slice(0, -6); // strip .jsonl
      const filePath = join(dirPath, file);
      const fileStat = await stat(filePath).catch(() => null);
      if (fileStat?.isFile()) {
        sessions.push({ sessionId, cwd, filePath, mtime: fileStat.mtime });
      }
    }
    sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    return sessions;
  } catch {
    return [];
  }
}

function decodeDirName(dir: string): string {
  // '-Users-foo-project' → '/Users/foo/project'
  if (dir.startsWith('-')) {
    return dir.slice(1).replace(/-/g, '/');
  }
  return dir;
}
