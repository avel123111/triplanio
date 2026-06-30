import { createClient } from '@supabase/supabase-js';
import { createAuthRetryFetch } from '@/lib/createAuthRetryFetch';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables. Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.');
}

// Recover a stale-token 401 once for EVERY authorized call (TRIP-56): the wrapper
// refreshes the session and replays the request with the fresh token. `() => supabase`
// is lazy so it resolves only when a 401 actually fires (the binding exists by then).
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
  global: {
    fetch: createAuthRetryFetch((...args) => fetch(...args), () => supabase),
  },
});
