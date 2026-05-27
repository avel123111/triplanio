import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * Service-role client — bypasses RLS. Use only inside Edge Functions
 * for operations that require reading/writing across user boundaries
 * (e.g. checking trip membership, sending notifications, syncing expenses).
 *
 * Never expose the service role key to the frontend.
 */
export const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

/**
 * Extracts the caller's Supabase user from the request's Authorization header.
 * Returns null if the header is absent or the token is invalid.
 *
 * Usage:
 *   const user = await getRequestUser(req);
 *   if (!user) return unauthorized();
 */
export async function getRequestUser(req: Request) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(
    authHeader.replace('Bearer ', ''),
  );
  if (error || !user) return null;
  return user; // user.id (uuid), user.email
}
