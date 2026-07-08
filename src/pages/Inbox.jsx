import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTheme } from '@/lib/ThemeContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useT, useI18n } from '@/lib/i18n/I18nContext';
import { isProActive } from '@/lib/subscription';
import { formatDistanceToNowStrict } from 'date-fns';
import { ru, es, enUS } from 'date-fns/locale';
import { Icon } from '../design/icons';
import { Btn, Badge, Skeleton, EmptyState } from '../design/index';
import AppHeader from '@/components/AppHeader';
import { notifMeta, emphasize } from '@/components/notifications/NotificationsBell';
import { useQueryGate } from '@/lib/useQueryGate';
import { SystemStub } from '@/lib/PageNotFound';
import '../design/app.css';

const DATE_LOCALES = { ru, es, en: enUS };

function dateGroup(iso) {
  if (!iso) return 'earlier';
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYest = new Date(startToday); startYest.setDate(startYest.getDate() - 1);
  const startWeek = new Date(startToday); startWeek.setDate(startWeek.getDate() - 7);
  if (d >= startToday) return 'today';
  if (d >= startYest) return 'yesterday';
  if (d >= startWeek) return 'week';
  return 'earlier';
}
const GROUP_ORDER = ['today', 'yesterday', 'week', 'earlier'];
const GROUP_LABEL_KEY = { today: 'common.today', yesterday: 'common.yesterday', week: 'notif.this_week', earlier: 'notif.earlier' };

export default function Inbox() {
  const nav = useNavigate();
  const { user } = useAuth();
  const t = useT();
  const { lang } = useI18n();
  const dateLocale = DATE_LOCALES[lang] || enUS;
  const qc = useQueryClient();
  const isPro = isProActive(user);
  const { isDark, toggle: toggleTheme } = useTheme();

  const [filter, setFilter] = useState('all');

  const {
    data: notifications = [], isLoading,
    error: notifError, isPending: notifPending, fetchStatus: notifFetchStatus, refetch: refetchNotifs,
  } = useQuery({
    queryKey: ['notifications', user?.email],
    queryFn: async () => {
      if (!user?.email) return [];
      const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.email,
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const ids = notifications.filter(n => !n.read).map(n => n.id);
      if (!ids.length) return;
      const { error } = await supabase.from('notifications').update({ read: true }).in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  // Per-notification mark-as-read, mirroring the bell popover (NotificationsBell).
  const markOneRead = useMutation({
    mutationFn: async (notifId) => {
      const { error } = await supabase.from('notifications').update({ read: true }).eq('id', notifId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const respondInvite = useMutation({
    mutationFn: async ({ memberId, action }) => {
      // Use the edge function: it sets user_id on the member (so the accepter
      // becomes a recognized participant under RLS), notifies the inviter, and
      // marks the invite notification read - none of which a raw update does.
      const { data, error } = await supabase.functions.invoke('respondTripInvite', {
        body: { member_id: memberId, action },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Failed');
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['trips'] });
      qc.invalidateQueries({ queryKey: ['trip-member', vars?.memberId] });
    },
  });

  const unreadCount = notifications.filter(n => !n.read).length;
  const inviteCount = notifications.filter(n => n.type === 'trip_invite').length;

  const filtered = notifications.filter(n => {
    if (filter === 'unread') return !n.read;
    if (filter === 'invites') return n.type === 'trip_invite';
    return true;
  });

  // Group by date bucket, keeping order.
  const groups = GROUP_ORDER
    .map(label => ({ label, items: filtered.filter(n => dateGroup(n.created_at) === label) }))
    .filter(g => g.items.length > 0);

  const TABS = [
    ['all', t('admin.notifications.filter_all'), 0],
    ['unread', t('notif.unread'), unreadCount],
    ['invites', t('notif.invitations'), inviteCount],
  ];

  // ── Load gate (TRIP-208) ──────────────────────────────────────────────────────
  // A failed notifications load must surface an error + retry, not silently render
  // the "inbox empty" screen. Cached list wins (hasData) — a background refetch
  // error never blanks an already-shown inbox.
  const inboxGate = useQueryGate(
    { isPending: notifPending, fetchStatus: notifFetchStatus, error: notifError },
    notifications.length > 0,
  );
  if (inboxGate === 'temporary' || inboxGate === 'access') {
    const isAccess = inboxGate === 'access';
    return (
      <div style={{ minHeight: '100vh' }}>
        <SystemStub
          icon={isAccess ? 'lock' : 'warning'}
          tone={isAccess ? 'warm' : 'warning'}
          title={t(isAccess ? 'sys.no_access_title' : 'sys.load_error_title')}
          body={t(isAccess ? 'sys.no_access_body' : 'sys.load_error_desc')}
          primary={{ label: t('sys.retry'), onClick: () => refetchNotifs() }}
          secondary={{ label: t('sys.to_my_trips'), onClick: () => nav('/trips') }}
        />
      </div>
    );
  }

  return (
    <div className="app-shell" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>
      <AppHeader
        user={user}
        isPro={isPro}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        onBack={() => nav('/trips')}
        backTitle={t('telegram.go_to_trips')}
        title={t('notif.inbox_title')}
      />

      <main className="ov-anim" style={{ flex: 1, padding: '32px 24px', maxWidth: 760, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <h1 style={{ flex: 1, marginBottom: 0 }}>{t('notif.inbox_title')}</h1>
          {notifications.length > 0 && unreadCount > 0 && (
            <Btn variant="ghost" size="sm" onClick={() => markAllRead.mutate()}>{t('notif.mark_all_read')}</Btn>
          )}
        </div>

        {notifications.length > 0 && (
          <div className="nfilters">
            {TABS.map(([k, l, c]) => (
              <button key={k} className={`fpill${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>
                {l}{c > 0 && <span className="fpill__c">{c}</span>}
              </button>
            ))}
          </div>
        )}

        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3, 4].map(i => <Skeleton key={i} w="100%" h={64} r={12} />)}
          </div>
        ) : notifications.length === 0 ? (
          <InboxEmpty onCollection={() => nav('/trips')} />
        ) : filtered.length === 0 ? (
          <EmptyState icon="bell" title={t('notif.filter_empty')} />
        ) : (
          <div className="nlist">
            {groups.map((g) => (
              <div key={g.label} className="ngrp">
                <div className="ngrp__label">{t(GROUP_LABEL_KEY[g.label])}</div>
                {g.items.map((n) => (
                  <InboxRow
                    key={n.id}
                    n={n}
                    t={t}
                    dateLocale={dateLocale}
                    pending={respondInvite.isPending}
                    onRespond={(action) => {
                      if (!n.read) markOneRead.mutate(n.id);
                      respondInvite.mutate({ memberId: n.trip_member_id, action });
                    }}
                    onMarkRead={() => { if (!n.read) markOneRead.mutate(n.id); }}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function InboxEmpty({ onCollection }) {
  const t = useT();
  // "What will land here" hint list — reuses existing tokens (no new CSS classes).
  const rows = [
    { icon: 'users', title: t('notif.invitations'), sub: t('notif.invitations_desc') },
    { icon: 'refresh', title: t('notif.updates'), sub: t('notif.updates_desc') },
    { icon: 'file', title: t('notif.whats_new'), sub: t('notif.whats_new_desc') },
  ];
  return (
    <EmptyState
      icon="bell"
      title={t('notif.inbox_empty')}
      body={t('notif.inbox_empty_lead')}
      action={
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 16 }}>
            {rows.map((r, i) => (
              <div
                key={r.icon}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '11px 6px',
                  borderBottom: i < rows.length - 1 ? '1px solid var(--line-2)' : 'none',
                }}
              >
                <span style={{
                  width: 34, height: 34, borderRadius: 10, flex: 'none',
                  background: 'var(--brand-soft)', color: 'var(--brand)',
                  display: 'grid', placeItems: 'center',
                }}>
                  <Icon name={r.icon} size={16} />
                </span>
                <span style={{ textAlign: 'left' }}>
                  <div className="t-ui" style={{ color: 'var(--ink-2)' }}>{r.title}</div>
                  <div className="t-meta" style={{ color: 'var(--muted)', marginTop: 1 }}>{r.sub}</div>
                </span>
              </div>
            ))}
          </div>
          <Btn variant="primary" icon="plus" block onClick={onCollection}>{t('notif.to_collection')}</Btn>
        </div>
      }
    />
  );
}

function InboxRow({ n, t, dateLocale, pending, onRespond, onMarkRead }) {
  const isInvite = n.type === 'trip_invite' && n.trip_member_id;
  const { data: member } = useQuery({
    queryKey: ['trip-member', n.trip_member_id],
    queryFn: async () => {
      const { data, error } = await supabase.from('trip_members').select('*').eq('id', n.trip_member_id).single();
      if (error) throw error;
      return data;
    },
    enabled: !!isInvite,
  });

  const time = n.created_at ? formatDistanceToNowStrict(new Date(n.created_at), { addSuffix: true, locale: dateLocale }) : '';
  const renderParams = (params = {}) => {
    const r = { ...params };
    if (r.role_key) { r.role = t(r.role_key); delete r.role_key; }
    return r;
  };
  const titleText = n.i18n_title_key ? t(n.i18n_title_key, renderParams(n.i18n_params)) : n.title;
  const messageText = n.i18n_message_key ? t(n.i18n_message_key, renderParams(n.i18n_params)) : n.message;
  const ip = n.i18n_params || {};
  const titleNode = isInvite ? emphasize(titleText, [{ value: ip.trip, style: { fontWeight: 700 /* design-token-exempt: inline mention emphasis */, color: 'var(--brand)' } }]) : titleText;
  const messageNode = isInvite ? emphasize(messageText, [{ value: ip.inviter, style: { fontWeight: 700 /* design-token-exempt: inline mention emphasis */ } }]) : messageText;
  const meta = notifMeta(n.type);
  const showPending = isInvite && member?.status === 'pending';

  return (
    <div
      className={`nrow${n.read ? '' : ' nrow--unread'}`}
      onClick={() => { if (!n.read) onMarkRead?.(); }}
    >
      <div className="n-ic" style={{ '--ic': meta.color }}>
        <Icon name={meta.icon} size={16} />
      </div>
      <div className="nrow__body">
        <div className="nrow__title">{titleNode}</div>
        {messageText && <div className="nrow__msg">{messageNode}</div>}
        <div className="nrow__meta">
          <span>{time}</span>
          {n.trip_id && (member?.status === 'active' || n.type !== 'trip_invite') && (
            <Link to={`/trip/${n.trip_id}`} className="nrow__link">
              <Icon name="pin" size={11} />{t('notif.view_trip')}
            </Link>
          )}
        </div>
      </div>
      <div className="nrow__acts">
        {showPending ? (
          <>
            <Btn variant="primary" size="sm" icon="check" disabled={pending} onClick={() => onRespond('accept')}>{t('notif.accept')}</Btn>
            <Btn variant="ghost" size="sm" disabled={pending} onClick={() => onRespond('decline')}>{t('notif.decline')}</Btn>
          </>
        ) : isInvite && member?.status === 'active' ? (
          <Badge variant="success" icon="check">{t('notif.accepted')}</Badge>
        ) : isInvite && member?.status === 'declined' ? (
          <Badge variant="quiet">{t('notif.declined')}</Badge>
        ) : null}
      </div>
    </div>
  );
}
