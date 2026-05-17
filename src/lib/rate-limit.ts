// R1-16 §FR-7: simple per-IP token bucket for /api/instances/register.
//
// In-memory only. Acceptable trade-off for R1: superadmin runs as a single
// Cloud Run instance with low concurrency, and rate-limiting registration
// attempts at the edge is best-effort defense in depth (the bootstrap token
// + approval gating are the real authorization).

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
  remaining: number;
}

export interface RateLimitOptions {
  key: string;
  limit?: number;
  windowSec?: number;
}

export function checkRateLimit(opts: RateLimitOptions): RateLimitResult {
  const limit = opts.limit ?? defaultLimit();
  const windowSec = opts.windowSec ?? 60;
  const now = Date.now();
  const windowMs = windowSec * 1000;

  const bucket = buckets.get(opts.key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(opts.key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSec: 0, remaining: limit - 1 };
  }

  if (bucket.count >= limit) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((bucket.windowStart + windowMs - now) / 1000),
    );
    return { allowed: false, retryAfterSec, remaining: 0 };
  }

  bucket.count += 1;
  return {
    allowed: true,
    retryAfterSec: 0,
    remaining: limit - bucket.count,
  };
}

export function _resetRateLimitForTests(): void {
  buckets.clear();
}

function defaultLimit(): number {
  const raw = process.env.REGISTRATION_RATE_LIMIT;
  if (!raw) return 5;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}
