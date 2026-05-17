import { z } from 'zod';

export const ModelSchema = z.enum(['opus', 'sonnet', 'haiku']);
export type ModelName = z.infer<typeof ModelSchema>;

export const ConfigSchema = z.object({
  discordToken: z.string().min(1, 'DISCORD_TOKEN 누락'),
  discordClientId: z.string().min(1, 'DISCORD_CLIENT_ID 누락'),
  discordGuildId: z.string().optional(),
  allowedUserIds: z.array(z.string()).min(1, 'ALLOWED_USER_IDS는 최소 1개 이상 필요합니다.').default([]),
  claudeBin: z.string().default('claude'),
  defaultModel: ModelSchema.default('sonnet'),
  permissionMode: z.enum(['acceptEdits', 'auto', 'default', 'dontAsk', 'plan']).default('default'),
  defaultLang: z.string().default('ko'),
  defaultCwd: z.string(),
  cdbHome: z.string(),
  logLevel: z.string().default('info'),
  idleTimeoutMs: z.number().int().positive().default(5 * 60 * 1000),
});
export type Config = z.infer<typeof ConfigSchema>;
