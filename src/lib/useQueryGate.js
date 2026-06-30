import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { queryGateKind } from '@/lib/loadStateClassify';

// Shared load gate (TRIP-56). Maps a React-Query result onto the screen kind
// ('loading' | 'auth' | 'temporary' | 'access' | 'ok') and auto-redirects a dead
// session to /login — the one piece of behaviour that was copy-pasted across
// TripView and TripStructureEdit. RENDER stays per-screen on purpose: each screen
// keeps its own skeleton and chooses what to draw for each kind; this hook only
// unifies CLASSIFICATION + the redirect, not the markup.
//
// @param {{ isPending: boolean, fetchStatus: string, error: unknown }} query
// @param {boolean} hasData - whether the screen already has usable (cached) data
// @returns {'loading'|'auth'|'temporary'|'access'|'ok'}
export function useQueryGate(query, hasData) {
  const nav = useNavigate();
  const kind = queryGateKind({
    isPending: query.isPending,
    fetchStatus: query.fetchStatus,
    error: query.error,
    hasData,
  });
  useEffect(() => {
    if (kind === 'auth') nav('/login', { replace: true });
  }, [kind, nav]);
  return kind;
}
