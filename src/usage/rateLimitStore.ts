export type RateLimitType =
  | 'five_hour'
  | 'seven_day'
  | 'seven_day_opus'
  | 'seven_day_sonnet'
  | 'overage';

export interface StoredLimit {
  rateLimitType: RateLimitType;
  status: string;
  utilization: number;
  resetsAt?: number;
  isUsingOverage?: boolean;
  capturedAt: number;
}

const KNOWN_TYPES: ReadonlySet<RateLimitType> = new Set([
  'five_hour',
  'seven_day',
  'seven_day_opus',
  'seven_day_sonnet',
  'overage',
]);

const store = new Map<RateLimitType, StoredLimit>();

/** 마지막으로 알림을 보낸 10% 버킷 (0~9: 0~90%) */
const lastNotifiedBucket = new Map<RateLimitType, number>();

/**
 * 해당 타입의 utilization이 10% 구간을 새로 넘었으면 true 반환 후 버킷 업데이트.
 * 처음 기록되거나 구간이 올라갔을 때만 true.
 */
export function shouldNotifyBucket(type: RateLimitType): boolean {
  const current = store.get(type);
  if (!current) return false;
  const currentBucket = Math.floor(current.utilization * 10);
  if (!lastNotifiedBucket.has(type)) {
    // 처음 기록 시: 현재 버킷으로 초기화만 하고 알림 없음 (재시작 false positive 방지)
    lastNotifiedBucket.set(type, currentBucket);
    return false;
  }
  const lastBucket = lastNotifiedBucket.get(type)!;
  if (currentBucket > lastBucket) {
    lastNotifiedBucket.set(type, currentBucket);
    return true;
  }
  return false;
}

export function clearNotifiedBuckets(): void {
  lastNotifiedBucket.clear();
}

export function recordRateLimit(info: unknown): void {
  if (!info || typeof info !== 'object') return;
  const i = info as {
    rateLimitType?: string;
    utilization?: number;
    status?: string;
    resetsAt?: number;
    isUsingOverage?: boolean;
    overageStatus?: string;
    overageResetsAt?: number;
  };

  const primary = i.rateLimitType as RateLimitType | undefined;
  if (primary && KNOWN_TYPES.has(primary)) {
    store.set(primary, {
      rateLimitType: primary,
      status: i.status ?? 'unknown',
      utilization: i.utilization ?? 0,
      resetsAt: i.resetsAt,
      isUsingOverage: i.isUsingOverage,
      capturedAt: Date.now(),
    });
  }

  if (typeof i.overageStatus === 'string' && typeof i.overageResetsAt === 'number') {
    store.set('overage', {
      rateLimitType: 'overage',
      status: i.overageStatus,
      utilization: i.isUsingOverage ? 1 : 0,
      resetsAt: i.overageResetsAt,
      isUsingOverage: i.isUsingOverage,
      capturedAt: Date.now(),
    });
  }
}

const TYPE_ORDER: RateLimitType[] = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'overage'];

export function getStoredLimits(): StoredLimit[] {
  return TYPE_ORDER.flatMap((t) => {
    const v = store.get(t);
    return v ? [v] : [];
  });
}

export function clearStoredLimits(): void {
  store.clear();
}
