import { createAdminClient } from '@/lib/supabase/admin';

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

  while (RATE_LIMIT_STORE.size >= MAX_STORE_ENTRIES) {
    const oldestKey = RATE_LIMIT_STORE.keys().next().value;
    if (oldestKey === undefined) break;
    RATE_LIMIT_STORE.delete(oldestKey);
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
      expiresAt: oldestInWindow + options.windowMs,
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

export function resetRateLimit(key: string): void {
  RATE_LIMIT_STORE.delete(key);
}

/**
 * Rate limit persistente respaldado en PostgreSQL (Supabase RPC `check_and_consume_rate_limit`)
 * para coordinar límites entre instancias serverless y cold starts.
 * Si la RPC aún no existe o falta `SUPABASE_SERVICE_ROLE_KEY`, degrada de forma segura
 * al almacenamiento en memoria del proceso.
 */
export async function checkPersistentSlidingWindowRateLimit(
  key: string,
  options: { maxRequests: number; windowMs: number }
): Promise<RateLimitResult> {
  const adminClient = createAdminClient();
  if (adminClient) {
    try {
      const { data, error } = await adminClient.rpc(
        'check_and_consume_rate_limit',
        {
          p_key: key,
          p_max_requests: options.maxRequests,
          p_window_ms: options.windowMs,
          p_now: new Date().toISOString(),
        }
      );

      if (!error && data && typeof data === 'object') {
        const payload = data as {
          allowed?: boolean;
          remaining?: number;
          retry_after_seconds?: number;
        };

        if (typeof payload.allowed === 'boolean') {
          return {
            allowed: payload.allowed,
            remaining: Math.max(0, Number(payload.remaining ?? 0)),
            retryAfterSeconds: Math.max(
              0,
              Number(payload.retry_after_seconds ?? 0)
            ),
          };
        }
      }
    } catch {
      // Fallback limpio al limitador en memoria
    }
  }

  return checkSlidingWindowRateLimit(key, options);
}

export async function resetPersistentRateLimit(key: string): Promise<void> {
  resetRateLimit(key);

  const adminClient = createAdminClient();
  if (!adminClient) {
    return;
  }

  try {
    await adminClient.rpc('reset_rate_limit_bucket', { p_key: key });
  } catch {
    // Ignorar si la RPC aún no ha sido creada
  }
}

export function formatRateLimitWaitEs(retryAfterSeconds: number): string {
  const safeSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  if (safeSeconds <= 15) {
    return 'unos segundos';
  }
  if (safeSeconds < 60) {
    return `${safeSeconds} segundos`;
  }
  const minutes = Math.ceil(safeSeconds / 60);
  return minutes === 1 ? '1 minuto' : `${minutes} minutos`;
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
