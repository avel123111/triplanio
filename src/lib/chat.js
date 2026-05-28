// Helpers for the trip chat: queries, read-markers, unread counters.
//
// All queries pivot on chat_id (from the chats table — one "group" chat per
// trip) and on user_id (uuid) rather than user_email. The old trip_id /
// user_email columns are still written for backward compat.

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';

export const CHAT_MESSAGES_KEY = (tripId) => ['chat-messages', tripId];
export const CHAT_READ_KEY     = (tripId, userId) => ['chat-read', tripId, userId];
export const CHAT_ID_KEY       = (tripId) => ['chat-id', tripId];

// ── Resolve group chat id from tripId ─────────────────────────────────────────

export function useChatId(tripId, { enabled = true } = {}) {
  return useQuery({
    queryKey: CHAT_ID_KEY(tripId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chats')
        .select('id')
        .eq('trip_id', tripId)
        .eq('type', 'group')
        .single();
      if (error) throw error;
      return data?.id || null;
    },
    enabled: !!tripId && enabled,
    staleTime: Infinity,
  });
}

// ── Timestamp helpers ─────────────────────────────────────────────────────────

function parseUtcMs(s) {
  if (!s) return 0;
  if (s instanceof Date) return s.getTime();
  let str = String(s);
  if (!/[zZ]$/.test(str) && !/[+-]\d{2}:?\d{2}$/.test(str)) str += 'Z';
  const t = new Date(str).getTime();
  return Number.isFinite(t) ? t : 0;
}

function toUtcIso(s) {
  if (!s) return new Date().toISOString();
  const ms = parseUtcMs(s);
  return ms ? new Date(ms).toISOString() : new Date().toISOString();
}

// ── Count unread ──────────────────────────────────────────────────────────────

export function countUnread(messages, lastReadAt, myUserId) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  const cutoff = parseUtcMs(lastReadAt);
  let n = 0;
  for (const m of messages) {
    if (m.user_id === myUserId) continue;
    const t = parseUtcMs(m.created_at);
    if (t > cutoff) n += 1;
  }
  return n;
}

// ── Fetch messages ────────────────────────────────────────────────────────────

export function useChatMessages(tripId, { enabled = true } = {}) {
  const { data: chatId } = useChatId(tripId, { enabled: !!tripId && enabled });
  return useQuery({
    queryKey: CHAT_MESSAGES_KEY(tripId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      // created_date shim — TripChatTab reads this field
      return (data || []).map((m) => ({ ...m, created_date: m.created_at }));
    },
    enabled: !!chatId && enabled,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

// ── Fetch my read marker ──────────────────────────────────────────────────────

export function useMyChatRead(tripId, { enabled = true } = {}) {
  const { user } = useAuth();
  const { data: chatId } = useChatId(tripId, { enabled: !!tripId && !!user?.id && enabled });
  return useQuery({
    queryKey: CHAT_READ_KEY(tripId, user?.id),
    queryFn: async () => {
      const { data } = await supabase
        .from('chat_reads')
        .select('*')
        .eq('chat_id', chatId)
        .eq('user_id', user.id)
        .maybeSingle();
      return data || null;
    },
    enabled: !!chatId && !!user?.id && enabled,
    refetchOnMount: 'always',
  });
}

// ── Unread count ──────────────────────────────────────────────────────────────

export function useUnreadChatCount(tripId, { enabled = true } = {}) {
  const { user } = useAuth();
  const { data: messages, isLoading: messagesLoading } = useChatMessages(tripId, { enabled });
  const { data: read, isLoading: readLoading }         = useMyChatRead(tripId, { enabled });
  useChatLiveSubscription(tripId, { enabled });
  return useMemo(() => {
    if (messagesLoading || readLoading) return 0;
    return countUnread(messages || [], read?.last_read_at, user?.id);
  }, [messages, read, user?.id, messagesLoading, readLoading]);
}

// ── Live subscription ─────────────────────────────────────────────────────────

export function useChatLiveSubscription(tripId, { enabled = true } = {}) {
  const { data: chatId } = useChatId(tripId, { enabled: !!tripId && enabled });
  const qc = useQueryClient();
  useEffect(() => {
    if (!chatId || !enabled) return undefined;
    const channel = supabase
      .channel(`chat-lib-${chatId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `chat_id=eq.${chatId}`,
      }, () => {
        qc.invalidateQueries({ queryKey: CHAT_MESSAGES_KEY(tripId) });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [chatId, tripId, enabled, qc]);
}

// ── Mark read ─────────────────────────────────────────────────────────────────

export async function markChatRead(tripId, userEmail, lastReadAt) {
  const ts = toUtcIso(lastReadAt);
  const [{ data: chat }, { data: userRow }] = await Promise.all([
    supabase.from('chats').select('id').eq('trip_id', tripId).eq('type', 'group').single(),
    supabase.from('users').select('id').eq('email', userEmail).single(),
  ]);
  if (!chat?.id || !userRow?.id) return null;
  const { data, error } = await supabase
    .from('chat_reads')
    .upsert(
      { chat_id: chat.id, user_id: userRow.id, trip_id: tripId, user_email: userEmail, last_read_at: ts },
      { onConflict: 'chat_id,user_id' },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}
