import { z } from 'zod';

export const ModelSchema = z.enum(['opus', 'sonnet', 'haiku']);
export type ModelName = z.infer<typeof ModelSchema>;

export const ConfigSchema = z.object({
  discordToken: z.string().min(1, 'DISCORD_TOKEN 누락'),
  discordClientId: z.string().min(1, 'DISCORD_CLIENT_ID 누락'),
  discordGuildId: z.string().optional(),
  allowedUserIds: z.array(z.string()).default([]),
  claudeBin: z.string().default('claude'),
  defaultModel: ModelSchema.default('sonnet'),
  defaultLang: z.string().default('ko'),
  cdbHome: z.string(),
  logLevel: z.string().default('info'),
});
export type Config = z.infer<typeof ConfigSchema>;
