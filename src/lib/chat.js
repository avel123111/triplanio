// Helpers for the trip chat: queries, read-markers, unread counters.
//
// Architecture:
// - ChatMessage entity holds the messages (one row per message).
// - ChatRead entity holds a per-user "last seen" timestamp (one row per user per trip).
// - Unread count = number of messages with created_date > my_last_read_at AND created_by != me.
//
// We use React Query for caching + a live `subscribe` on the ChatMessage entity to
// invalidate the cache when new messages arrive.

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

export const CHAT_MESSAGES_KEY = (tripId) => ['chat-messages', tripId];
export const CHAT_READ_KEY = (tripId, email) => ['chat-read', tripId, email];

/** Fetch all messages for a trip, ascending by created_date.
 *  refetchOnMount=always guarantees that the counter is recomputed every time
 *  the user navigates to a TripView (so opening a trip shows the badge for
 *  messages that arrived while the user was on /trips or another trip).
 *  Real-time updates come from useChatLiveSubscription — no polling needed
 *  (polling caused 429 rate-limit errors).
 */
export function useChatMessages(tripId, { enabled = true } = {}) {
  return useQuery({
    queryKey: CHAT_MESSAGES_KEY(tripId),
    queryFn: () => base44.entities.ChatMessage.filter({ trip_id: tripId }, 'created_date'),
    enabled: !!tripId && enabled,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

/** Fetch the current user's read marker for this trip (or null). */
export function useMyChatRead(tripId, { enabled = true } = {}) {
  const { user } = useAuth();
  return useQuery({
    queryKey: CHAT_READ_KEY(tripId, user?.email),
    queryFn: async () => {
      const rows = await base44.entities.ChatRead.filter({ trip_id: tripId, user_email: user.email });
      return rows[0] || null;
    },
    enabled: !!tripId && !!user?.email && enabled,
    refetchOnMount: 'always',
  });
}

/** Parse a timestamp string as UTC. Base44 sometimes returns ISO strings without
 *  a "Z" suffix for freshly created records (e.g. "2026-05-23T21:37:49.496000"),
 *  which `new Date()` interprets as LOCAL time. We always want UTC, so we
 *  append "Z" when no timezone designator is present. */
function parseUtcMs(s) {
  if (!s) return 0;
  if (s instanceof Date) return s.getTime();
  let str = String(s);
  // If the string ends with a "Z" or has a +HH:MM/-HH:MM offset, leave it alone.
  if (!/[zZ]$/.test(str) && !/[+-]\d{2}:?\d{2}$/.test(str)) {
    str = str + 'Z';
  }
  const t = new Date(str).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Normalize an ISO timestamp so it always carries a UTC designator.
 *  Ensures we write consistent values into the DB (always with "Z"). */
function toUtcIso(s) {
  if (!s) return new Date().toISOString();
  const ms = parseUtcMs(s);
  return ms ? new Date(ms).toISOString() : new Date().toISOString();
}

/** Count messages newer than `lastReadAt` and not authored by me. */
export function countUnread(messages, lastReadAt, myEmail) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  const cutoff = parseUtcMs(lastReadAt);
  let n = 0;
  for (const m of messages) {
    if (m.user_email === myEmail) continue;
    const t = parseUtcMs(m.created_date);
    if (t > cutoff) n += 1;
  }
  return n;
}

/** Hook: returns the current unread count for the trip chat.
 *  Activates a live subscription on ChatMessage so the counter updates in real
 *  time even when the user is on another tab (timeline/map/etc.).
 */
export function useUnreadChatCount(tripId, { enabled = true } = {}) {
  const { user } = useAuth();
  const { data: messages, isLoading: messagesLoading } = useChatMessages(tripId, { enabled });
  const { data: read, isLoading: readLoading } = useMyChatRead(tripId, { enabled });
  // Live-subscribe at the TripView level so the badge updates without opening the tab.
  useChatLiveSubscription(tripId, { enabled });
  return useMemo(() => {
    // Don't show a transient "all messages are unread" badge while the read
    // marker is still loading — the messages query usually resolves first and
    // counting against an undefined cutoff falsely lights up the icon for
    // ~1s on every TripView open.
    if (messagesLoading || readLoading) return 0;
    return countUnread(messages || [], read?.last_read_at, user?.email);
  }, [messages, read, user?.email, messagesLoading, readLoading]);
}

/**
 * Subscribe to ChatMessage create/update/delete and invalidate the messages
 * cache for the given trip whenever a relevant event arrives.
 * Returns nothing — meant to be called inside a useEffect.
 */
export function useChatLiveSubscription(tripId, { enabled = true } = {}) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!tripId || !enabled) return undefined;
    const unsub = base44.entities.ChatMessage.subscribe((event) => {
      const row = event?.data;
      if (row && row.trip_id !== tripId) return;
      qc.invalidateQueries({ queryKey: CHAT_MESSAGES_KEY(tripId) });
    });
    return () => { try { unsub?.(); } catch { /* ignore */ } };
  }, [tripId, enabled, qc]);
}

/**
 * Upsert the current user's read marker to `now` (or to a specific timestamp).
 * Safe to call repeatedly — no-op if already up-to-date.
 */
export async function markChatRead(tripId, userEmail, lastReadAt) {
  // Always normalize to a UTC ISO string with "Z" — both for writing into the
  // DB and for the timestamp comparison below. Mixing naive and Z-suffixed
  // strings caused the badge to never clear (the comparison was done across
  // different timezones).
  const ts = toUtcIso(lastReadAt);
  const existing = await base44.entities.ChatRead.filter({ trip_id: tripId, user_email: userEmail });
  if (existing.length > 0) {
    const cur = existing[0];
    if (cur.last_read_at && parseUtcMs(cur.last_read_at) >= parseUtcMs(ts)) return cur;
    return base44.entities.ChatRead.update(cur.id, { last_read_at: ts });
  }
  return base44.entities.ChatRead.create({ trip_id: tripId, user_email: userEmail, last_read_at: ts });
}