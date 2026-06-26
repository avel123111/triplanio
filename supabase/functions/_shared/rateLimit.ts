/**
 * Shared rate-limit primitive (TRIP-67).
 *
 * Backed by the single `rate_limit_hits` table + `rate_limit_check` /
 * `rate_limit_record` RPCs (service-role only). Used by the anonymous auth
 * endpoints (signupPrecheck / requestPasswordReset) to bound email enumeration.
 *
 * Design: limits are best-effort and FAIL OPEN — a limiter/DB hiccup must never
 * lock a legitimate user out of login or password reset. The goal is to make
 * bulk enumeration impractical, not to be a hard gate.
 */
import { supabaseAdmin } from './supabaseAdmin.ts';

/** Best-effort client IP from the edge proxy headers (first hop of XFF). */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() || null;
}

/** True when (bucket,key) is still UNDER `max` within the rolling window. */
export async function underLimit(
  bucket: string,
  key: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('rate_limit_check', {
    p_bucket: bucket,
    p_key: key,
    p_max: max,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error('rate_limit_check failed', bucket, error.message);
    return true; // fail open
  }
  return data === true;
}

/** Record one hit for (bucket,key). Never throws. */
export async function recordHit(bucket: string, key: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('rate_limit_record', {
    p_bucket: bucket,
    p_key: key,
  });
  if (error) console.error('rate_limit_record failed', bucket, error.message);
}

/**
 * Enforce the standard per-IP abuse limit (10/min AND 60/hour) for `bucket`.
 * Returns true when the request should be BLOCKED (rate-limited). Returns false
 * (allowed) and records the hit when under the limit, OR when the IP is unknown
 * — best-effort, we never block a request we can't key by IP.
 */
export async function ipRateLimited(req: Request, bucket: string): Promise<boolean> {
  const ip = clientIp(req);
  if (!ip) return false;
  const okMinute = await underLimit(bucket, ip, 10, 60);
  const okHour = await underLimit(bucket, ip, 60, 3600);
  if (!okMinute || !okHour) return true;
  await recordHit(bucket, ip);
  return false;
}
