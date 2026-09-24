import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

/** PATH가 빈약한 launchd 환경에서도 찾을 수 있도록 흔한 설치 위치를 덧붙인다. */
const FALLBACK_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  join(homedir(), '.local', 'bin'),
  join(homedir(), '.claude', 'local'),
];

/** Resolve a command name to an absolute executable path, or null if not found. */
export function resolveExecutable(bin: string, pathEnv = process.env.PATH ?? ''): string | null {
  if (isAbsolute(bin)) return isExecutable(bin) ? bin : null;
  const dirs = [...pathEnv.split(delimiter).filter(Boolean), ...FALLBACK_DIRS];
  for (const dir of dirs) {
    const candidate = join(dir, bin);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
