import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultCdbHome(): string {
  return process.env.CDB_HOME ?? join(homedir(), '.claude-discord-bot');
}
