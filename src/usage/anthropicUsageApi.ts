/**
 * Claude HUD와 동일한 방식으로 Anthropic OAuth Usage API를 호출하여
 * 5시간 / 7일 사용량(utilization %)을 가져온다.
 *
 * API: GET https://api.anthropic.com/api/oauth/usage
 * 헤더: Authorization: Bearer <oauth_access_token>
 *       anthropic-beta: oauth-2025-04-20
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as https from 'node:https';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const KEYCHAIN_SERVICE_NAME = 'Claude Code-credentials';
const CREDENTIALS_FILE = path.join(os.homedir(), '.claude', '.credentials.json');
const CACHE_TTL_MS = 5 * 60_000; // 5분 캐시

export interface AnthropicUsage {
  fiveHour: number | null;       // 0-100 (%)
  sevenDay: number | null;
  fiveHourResetAt: Date | null;
  sevenDayResetAt: Date | null;
}

interface UsageApiResponse {
  five_hour?: { utilization?: number; resets_at?: string };
  seven_day?: { utilization?: number; resets_at?: string };
}

// 메모리 캐시 (봇은 장기 프로세스이므로 in-memory로 충분)
let cache: { data: AnthropicUsage; timestamp: number } | null = null;

function clamp(v: number): number {
  return Math.round(Math.max(0, Math.min(100, v)));
}

function parseDate(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** macOS 키체인에서 Claude Code OAuth 토큰 읽기 */
function readTokenFromKeychain(): string | null {
  if (process.platform !== 'darwin') return null;
  try {
    const configDir = path.join(os.homedir(), '.claude');
    const hash = createHash('sha256').update(path.resolve(configDir)).digest('hex').slice(0, 8);
    const serviceNames = [
      KEYCHAIN_SERVICE_NAME,
      `${KEYCHAIN_SERVICE_NAME}-${hash}`,
    ];
    const accountName = (() => {
      try { return os.userInfo().username.trim() || undefined; } catch { return undefined; }
    })();

    for (const svc of serviceNames) {
      try {
        const args = accountName
          ? ['find-generic-password', '-s', svc, '-a', accountName, '-w']
          : ['find-generic-password', '-s', svc, '-w'];
        const raw = execFileSync('/usr/bin/security', args, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 3000,
        }).trim();
        if (!raw) continue;
        const data = JSON.parse(raw);
        const token = data.claudeAiOauth?.accessToken;
        const expiresAt = data.claudeAiOauth?.expiresAt;
        if (token && (expiresAt == null || expiresAt > Date.now())) {
          return token as string;
        }
      } catch { /* 다음 시도 */ }
    }
  } catch { /* keychain 접근 불가 */ }
  return null;
}

/** ~/.claude/.credentials.json 파일에서 OAuth 토큰 읽기 (폴백) */
function readTokenFromFile(): string | null {
  try {
    if (!fs.existsSync(CREDENTIALS_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    const token = data.claudeAiOauth?.accessToken;
    const expiresAt = data.claudeAiOauth?.expiresAt;
    if (token && (expiresAt == null || expiresAt > Date.now())) {
      return token as string;
    }
  } catch { /* ignore */ }
  return null;
}

function getAccessToken(): string | null {
  return readTokenFromKeychain() ?? readTokenFromFile();
}

function fetchUsageApi(accessToken: string): Promise<UsageApiResponse | null> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/api/oauth/usage',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': 'claude-code/2.1',
        },
        timeout: 10_000,
      },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => { body += c.toString(); });
        res.on('end', () => {
          if (res.statusCode !== 200) { resolve(null); return; }
          try { resolve(JSON.parse(body) as UsageApiResponse); }
          catch { resolve(null); }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

/**
 * 5시간/7일 사용량 % 조회. 실패 시 null 반환.
 * 5분 in-memory 캐시 적용.
 */
export async function getAnthropicUsage(): Promise<AnthropicUsage | null> {
  const now = Date.now();

  // 캐시 히트
  if (cache && now - cache.timestamp < CACHE_TTL_MS) {
    return cache.data;
  }

  const token = getAccessToken();
  if (!token) return null;

  const raw = await fetchUsageApi(token);
  if (!raw) return null;

  const data: AnthropicUsage = {
    fiveHour: raw.five_hour?.utilization != null ? clamp(raw.five_hour.utilization) : null,
    sevenDay: raw.seven_day?.utilization != null ? clamp(raw.seven_day.utilization) : null,
    fiveHourResetAt: parseDate(raw.five_hour?.resets_at),
    sevenDayResetAt: parseDate(raw.seven_day?.resets_at),
  };

  cache = { data, timestamp: now };
  return data;
}

/** 캐시 강제 초기화 (테스트용) */
export function clearAnthropicUsageCache(): void {
  cache = null;
}
