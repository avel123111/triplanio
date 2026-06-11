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
import HeaderActions from '@/components/HeaderActions';
import { notifMeta, emphasize } from '@/components/notifications/NotificationsBell';
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

  const { data: notifications = [], isLoading } = useQuery({
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>
      <header className="app-header" style={{ position: 'sticky', top: 0, zIndex: 50 }}>
        <button className="app-header__crumb-back" onClick={() => nav('/trips')} title={t('telegram.go_to_trips')}>
          <Icon name="back" size={14} />
        </button>
        <div className="app-header__brand" onClick={() => nav('/trips')} style={{ cursor: 'pointer' }}>
          <img src="/triplanio-logo.svg" alt="Triplanio" style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0 }} />
          <span className="app-header__brand-name">Triplanio</span>
        </div>
        <div className="app-header__crumb">
          <span className="app-header__crumb-sep">/</span>
          <span style={{ fontSize: 'var(--fs-base)', fontWeight: 500, color: 'var(--ink-2)' }}>{t('notif.inbox_title')}</span>
        </div>
        <HeaderActions user={user} isPro={isPro} isDark={isDark} onToggleTheme={toggleTheme} />
      </header>

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
          <InboxEmpty onCollection={() => nav('/trips')} onAi={() => nav('/plan-trip-ai')} />
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

function InboxEmpty({ onCollection, onAi }) {
  const t = useT();
  return (
    <EmptyState
      icon="bell"
      title={t('notif.inbox_empty')}
      body={t('notif.inbox_empty_desc')}
      action={
        <div style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Btn variant="primary" icon="plus" onClick={onCollection}>{t('notif.to_collection')}</Btn>
          <Btn variant="ghost" icon="sparkles" onClick={onAi}>{t('trips.ai')}</Btn>
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
  const titleNode = isInvite ? emphasize(titleText, [{ value: ip.trip, style: { fontWeight: 700, color: 'var(--brand)' } }]) : titleText;
  const messageNode = isInvite ? emphasize(messageText, [{ value: ip.inviter, style: { fontWeight: 700 } }]) : messageText;
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
