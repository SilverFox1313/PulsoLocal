interface RateLimitBucket {
  timestamps: number[];
  expiresAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const RATE_LIMIT_STORE = new Map<string, RateLimitBucket>();
const MAX_STORE_ENTRIES = 5000;

function pruneExpiredBuckets(nowMs: number) {
  if (RATE_LIMIT_STORE.size < MAX_STORE_ENTRIES) {
    return;
  }

  for (const [key, bucket] of RATE_LIMIT_STORE.entries()) {
    if (bucket.expiresAt <= nowMs) {
      RATE_LIMIT_STORE.delete(key);
    }
  }
}

export function checkSlidingWindowRateLimit(
  key: string,
  options: { maxRequests: number; windowMs: number }
): RateLimitResult {
  const nowMs = Date.now();
  pruneExpiredBuckets(nowMs);

  const windowStart = nowMs - options.windowMs;
  const existing = RATE_LIMIT_STORE.get(key);
  const recentTimestamps = existing
    ? existing.timestamps.filter((ts) => ts > windowStart)
    : [];

  if (recentTimestamps.length >= options.maxRequests) {
    const oldestInWindow = recentTimestamps[0] ?? nowMs;
    const retryAfterMs = Math.max(1000, oldestInWindow + options.windowMs - nowMs);
    RATE_LIMIT_STORE.set(key, {
      timestamps: recentTimestamps,
      expiresAt: nowMs + options.windowMs,
    });

    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    };
  }

  recentTimestamps.push(nowMs);
  RATE_LIMIT_STORE.set(key, {
    timestamps: recentTimestamps,
    expiresAt: nowMs + options.windowMs,
  });

  return {
    allowed: true,
    remaining: Math.max(0, options.maxRequests - recentTimestamps.length),
    retryAfterSeconds: 0,
  };
}

export function getRequestClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const firstIp = forwarded.split(',')[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }

  return 'unknown';
}
