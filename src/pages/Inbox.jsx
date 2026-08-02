import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTheme } from '@/lib/ThemeContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { useNotificationList, useUnreadNotificationCount, useNotificationActions } from '@/lib/useNotifications';
import { useAuth } from '@/lib/AuthContext';
import { useT, useI18nFormat } from '@/lib/i18n/I18nContext';
import { isProActive } from '@/lib/subscription';
import { Icon } from '../design/icons';
import { Btn, Badge, Skeleton, EmptyState } from '../design/index';
import AppHeader from '@/components/AppHeader';
import { notifMeta, emphasize } from '@/components/notifications/NotificationsBell';
import { useQueryGate } from '@/lib/useQueryGate';
import { gateStubProps } from '@/lib/loadStateClassify';
import { SystemStub } from '@/lib/PageNotFound';
import '../design/app.css';

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
  const { fmtRelative } = useI18nFormat();
  const isPro = isProActive(user);
  const { isDark, toggle: toggleTheme } = useTheme();

  const [filter, setFilter] = useState('all');

  // Shared seam (src/lib/useNotifications.js) — the same single list the bell
  // renders the head of.
  const {
    data: notifications = [], isLoading,
    error: notifError, isPending: notifPending, fetchStatus: notifFetchStatus, refetch: refetchNotifs,
  } = useNotificationList();
  const { markAllRead, markOneRead, respondInvite } = useNotificationActions();

  const unreadCount = useUnreadNotificationCount();
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
    ['all', t('notif.all'), 0],
    ['unread', t('notif.unread'), unreadCount],
    ['invites', t('notif.invitations'), inviteCount],
  ];

  // ── Load gate (TRIP-208) ──────────────────────────────────────────────────────
  // A failed notifications load must surface an error + retry, not silently render
  // the "inbox empty" screen. Cached list wins (hasData) — a background refetch
  // error never blanks an already-shown inbox.
  // Collection: empty = "nothing yet" via useQueryGate's fail-safe default; a
  // real load failure still gates via the thrown-error path below (TRIP-220).
  const inboxGate = useQueryGate(
    { isPending: notifPending, fetchStatus: notifFetchStatus, error: notifError },
    notifications.length > 0,
  );
  if (inboxGate === 'temporary' || inboxGate === 'access' || inboxGate === 'not_found') {
    const stub = gateStubProps(inboxGate);
    const isTemporary = inboxGate === 'temporary';
    return (
      <div style={{ minHeight: '100vh' }}>
        <SystemStub
          icon={stub.icon}
          tone={stub.tone}
          title={t(stub.title)}
          body={t(stub.body)}
          primary={isTemporary
            ? { label: t('sys.retry'), onClick: () => refetchNotifs() }
            : { label: t('sys.to_my_trips'), onClick: () => nav('/trips') }}
          secondary={isTemporary ? { label: t('sys.to_my_trips'), onClick: () => nav('/trips') } : undefined}
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
            <Btn variant="ghost" onClick={() => markAllRead.mutate()}>{t('notif.mark_all_read')}</Btn>
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
            {[1, 2, 3, 4].map(i => <Skeleton key={i} w="100%" h={64} r={'var(--r-sm)'} />)}
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
                    fmtRelative={fmtRelative}
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
                  borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : 'none',
                }}
              >
                <span style={{
                  width: 34, height: 34, borderRadius: 'var(--r-sm)', flex: 'none',
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

function InboxRow({ n, t, fmtRelative, pending, onRespond, onMarkRead }) {
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

  const time = fmtRelative(n.created_at);
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
            <Btn variant="primary" icon="check" disabled={pending} onClick={() => onRespond('accept')}>{t('notif.accept')}</Btn>
            <Btn variant="ghost" disabled={pending} onClick={() => onRespond('decline')}>{t('notif.decline')}</Btn>
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
