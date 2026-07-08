/**
 * classifyDbError — the ONE place that maps a Supabase/Postgres query error onto
 * our error taxonomy (TRIP-208 re-analysis).
 *
 * The bug this closes: Ф1 used a binary split ("PGRST116 → 404, everything else →
 * 5xx"). But a query can fail in several distinct ways, and only some are
 * transient. A malformed uuid (22P02) is PERMANENT — retrying never helps — yet
 * the binary split threw it as a 5xx "temporary" error. The user opening a trip
 * by a broken id saw "Произошёл временный сбой, повтори" forever.
 *
 * The taxonomy (mirror of the client in src/lib/loadStateClassify.js — keep both
 * in sync):
 *   'not_found' → 404  the row isn't there OR the identifier is unusable (bad
 *                       uuid/int/enum, out-of-range). A dead end, not a retry.
 *   'denied'    → 403  a real permission failure (RLS deny).
 *   'auth'      → 401  the session/JWT itself is invalid.
 *   'conflict'  → 409  a write violated a constraint (unique/fk/check/not-null).
 *   'bug'       → 500  our fault (undefined table/column/function, schema drift) —
 *                       5xx to the user, but it must page us, not ask them to retry.
 *   'transient' → 500  timeout / deadlock / connection / unknown — genuinely
 *                       retryable. This is the SAFE DEFAULT: an unrecognised error
 *                       is treated as retryable, never as a silent permanent deny.
 */

export type DbErrorKind =
  | 'not_found'
  | 'denied'
  | 'auth'
  | 'conflict'
  | 'bug'
  | 'transient';

const NOT_FOUND = new Set([
  'PGRST116', // no rows for .single()/.maybeSingle()
  '22P02',    // invalid text representation (bad uuid/int/enum)
  '22003',    // numeric value out of range
  '22007',    // invalid datetime format
  '22008',    // datetime field overflow
]);
const DENIED = new Set([
  '42501', // insufficient_privilege (RLS deny)
]);
const AUTH = new Set([
  'PGRST301', // JWT expired
  'PGRST302', // anonymous/invalid JWT
]);
const CONFLICT = new Set([
  '23505', // unique_violation
  '23503', // foreign_key_violation
  '23514', // check_violation
  '23502', // not_null_violation
]);
const BUG = new Set([
  '42P01',    // undefined_table
  '42703',    // undefined_column
  '42883',    // undefined_function
  'PGRST202', // function not found in schema cache
  'PGRST204', // column not found in schema cache
]);

const STATUS: Record<DbErrorKind, number> = {
  not_found: 404,
  denied: 403,
  auth: 401,
  conflict: 409,
  bug: 500,
  transient: 500,
};

export interface ClassifiedError {
  kind: DbErrorKind;
  httpStatus: number;
  code: string | null;
}

/** Classify a supabase-js query error object (the `error` from `{ data, error }`). */
export function classifyDbError(error: unknown): ClassifiedError {
  const code = (error as { code?: string } | null)?.code ?? null;
  let kind: DbErrorKind = 'transient'; // safe default: unknown ⇒ retryable, never a silent deny
  if (code) {
    if (NOT_FOUND.has(code)) kind = 'not_found';
    else if (DENIED.has(code)) kind = 'denied';
    else if (AUTH.has(code)) kind = 'auth';
    else if (CONFLICT.has(code)) kind = 'conflict';
    else if (BUG.has(code)) kind = 'bug';
  }
  return { kind, httpStatus: STATUS[kind], code };
}

/** True when the error means "the thing genuinely isn't there / the id is unusable"
 *  — i.e. safe to treat like a zero-row result (404 / not-a-member), NOT a 5xx. */
export function isNotFound(error: unknown): boolean {
  return classifyDbError(error).kind === 'not_found';
}
