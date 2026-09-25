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
  // thinking은 출력 토큰이라 가장 비싸고, 한국어는 영어보다 토큰이 많이 든다.
  // 기본은 강제하지 않고(off) 모델에 맡긴다. 'ko' 등을 지정하면 thinking 언어도 강제한다.
  thinkingLang: z.string().default('off'),
  // false면 허용된 사용자의 일반 메시지에도 반응한다(usage 채널 제외).
  requireMention: z.boolean().default(false),
  defaultCwd: z.string(),
  cdbHome: z.string(),
  logLevel: z.string().default('info'),
  // 프롬프트 캐시 TTL(1시간)보다 약간 짧게. 그 이상 들고 있어도 캐시는 이미 만료된다.
  idleTimeoutMs: z.number().int().positive().default(55 * 60 * 1000),
});
export type Config = z.infer<typeof ConfigSchema>;
