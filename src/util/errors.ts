/**
 * Structured bot error with user-facing Korean messages.
 */
export class BotError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'BotError';
  }
}

export const Errors = {
  noPermission: () => new BotError('no permission', '권한이 없습니다.', 'NO_PERMISSION'),
  sessionNotFound: () => new BotError('session not found', '세션을 찾을 수 없습니다.', 'SESSION_NOT_FOUND'),
  runnerBusy: () => new BotError('runner busy', '이전 응답이 아직 진행 중입니다. `/cdb stop` 후 재시도하세요.', 'RUNNER_BUSY'),
  claudeNotFound: () => new BotError('claude binary not found', '`claude` 바이너리를 찾을 수 없습니다. PATH를 확인하세요.', 'CLAUDE_NOT_FOUND'),
  guildOnly: () => new BotError('guild only', '길드 내에서만 사용 가능합니다.', 'GUILD_ONLY'),
} as const;
