// Single source for parsing Supabase edge-function errors.
//
// supabase-js wraps any non-2xx response in a FunctionsHttpError whose body is
// on `error.context` (a Response) - NOT on `error.response.data`. The real
// `{ error, code }` payload must be read via `await error.context.json()`.
// `invoke()` leaves `data` null on a non-2xx, but some functions return
// `{ error }` with a 200, so check `data` too.
//
// Returns { code, message }. Pass `fallback` for a default user-facing message.
export async function parseEdgeError(error, data, fallback = null) {
  let body = null;
  if (data && (data.error || data.code)) body = data;
  if (!body) {
    try { body = await error?.context?.json?.(); } catch { /* not JSON */ }
  }
  const code = body?.code || null;
  const message = body?.error
    || (error?.message && !/non-2xx/i.test(error.message) ? error.message : null)
    || fallback;
  return { code, message };
}

// Convenience: resolve just the user-facing message (mirrors the old
// MembersLens.edgeErrorMessage helper).
export async function edgeErrorMessage(error, data, fallback = 'Ошибка') {
  const { message } = await parseEdgeError(error, data, fallback);
  return message || fallback;
}
