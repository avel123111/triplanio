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
import { Btn, Badge, Skeleton } from '../design/index';
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
    ['all', t('admin.notifications.filter_all')],
    ['unread', `${t('notif.unread')}${unreadCount ? ` · ${unreadCount}` : ''}`],
    ['invites', `${t('notif.invitations')}${inviteCount ? ` · ${inviteCount}` : ''}`],
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
          <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink-2)' }}>{t('notif.inbox_title')}</span>
        </div>
        <HeaderActions user={user} isPro={isPro} isDark={isDark} onToggleTheme={toggleTheme} />
      </header>

      <main style={{ flex: 1, padding: '32px 24px', maxWidth: 760, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <h1 style={{ flex: 1, marginBottom: 0 }}>{t('notif.inbox_title')}</h1>
          {notifications.length > 0 && unreadCount > 0 && (
            <Btn variant="ghost" size="sm" onClick={() => markAllRead.mutate()}>{t('notif.mark_all_read')}</Btn>
          )}
        </div>

        {notifications.length > 0 && (
          <div className="tweaks__seg" style={{ marginBottom: 18, display: 'inline-flex' }}>
            {TABS.map(([k, l]) => (
              <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{l}</button>
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
          <div style={{ textAlign: 'center', padding: '36px 24px', color: 'var(--muted)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14 }}>
            <Icon name="bell" size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
            <div style={{ fontSize: 13.5 }}>{t('notif.filter_empty')}</div>
          </div>
        ) : (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
            {groups.map((g, gi) => (
              <div key={g.label}>
                <div style={{ padding: '10px 18px', fontSize: 11, color: 'var(--muted-2)', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, background: 'var(--wash-2)', borderTop: gi > 0 ? '1px solid var(--line-2)' : 'none', borderBottom: '1px solid var(--line-2)' }}>
                  {t(GROUP_LABEL_KEY[g.label])}
                </div>
                {g.items.map((n, ni) => (
                  <InboxRow
                    key={n.id}
                    n={n}
                    t={t}
                    dateLocale={dateLocale}
                    last={ni === g.items.length - 1 && gi === groups.length - 1}
                    pending={respondInvite.isPending}
                    onRespond={(action) => respondInvite.mutate({ memberId: n.trip_member_id, action })}
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
  const hints = [
    { icon: 'users', title: t('notif.invitations'), desc: t('notif.invitations_desc') },
    { icon: 'vote',  title: t('notif.votes'), desc: t('notif.votes_desc') },
    { icon: 'edit',  title: t('notif.updates'),  desc: t('notif.updates_desc') },
  ];
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--line)',
      borderRadius: 14,
      padding: '56px 28px',
      textAlign: 'center',
    }}>
      <div style={{
        width: 84, height: 84, margin: '0 auto 22px', borderRadius: 22,
        background: 'linear-gradient(135deg, var(--brand-soft), var(--wash))',
        color: 'var(--brand)',
        display: 'grid', placeItems: 'center', position: 'relative',
      }}>
        <Icon name="bell" size={36} />
        <span style={{
          position: 'absolute', bottom: 4, right: 4,
          width: 26, height: 26, borderRadius: '50%',
          background: 'var(--success)', color: 'white',
          display: 'grid', placeItems: 'center',
          border: '3px solid var(--surface)',
        }}>
          <Icon name="check" size={13} />
        </span>
      </div>
      <h2 style={{ marginBottom: 8, fontSize: 22, letterSpacing: '-0.02em' }}>{t('notif.inbox_empty')}</h2>
      <div className="muted" style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 420, margin: '0 auto 22px' }}>
        {t('notif.inbox_empty_desc')}
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10,
        maxWidth: 460, margin: '0 auto', textAlign: 'left',
      }}>
        {hints.map((h) => (
          <div key={h.title} style={{
            padding: '12px 14px',
            background: 'var(--wash)',
            border: '1px solid var(--line-2)',
            borderRadius: 10,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: 'var(--brand-soft)', color: 'var(--brand)',
              display: 'grid', placeItems: 'center',
              marginBottom: 6,
            }}>
              <Icon name={h.icon} size={14} />
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 2 }}>{h.title}</div>
            <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.45 }}>{h.desc}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 26, display: 'inline-flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Btn variant="primary" icon="plus" onClick={onCollection}>{t('notif.to_collection')}</Btn>
        <Btn variant="ghost" icon="sparkles" onClick={onAi}>{t('trips.ai')}</Btn>
      </div>
    </div>
  );
}

function InboxRow({ n, t, dateLocale, last, pending, onRespond }) {
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
    <div style={{
      display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 14, padding: '14px 18px', alignItems: 'center',
      borderBottom: last ? 'none' : '1px solid var(--line-2)',
      background: n.read ? 'transparent' : 'var(--brand-soft)',
    }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: `color-mix(in oklab, ${meta.color} 14%, transparent)`, color: meta.color, display: 'grid', placeItems: 'center' }}>
        <Icon name={meta.icon} size={16} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, lineHeight: 1.45, fontWeight: 500 }}>{titleNode}</div>
        {messageText && <div className="muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.4 }}>{messageNode}</div>}
        <div className="muted" style={{ fontSize: 11.5, marginTop: 3, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>{time}</span>
          {n.trip_id && (member?.status === 'active' || n.type !== 'trip_invite') && (
            <Link to={`/trip/${n.trip_id}`} style={{ color: 'var(--brand)', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Icon name="pin" size={11} />{t('notif.view_trip')}
            </Link>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
