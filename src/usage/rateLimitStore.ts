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
