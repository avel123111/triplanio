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
import { notifMeta } from '@/components/notifications/NotificationsBell';
import '../design/app.css';

const DATE_LOCALES = { ru, es, en: enUS };

function dateGroup(iso) {
  if (!iso) return 'Ранее';
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYest = new Date(startToday); startYest.setDate(startYest.getDate() - 1);
  const startWeek = new Date(startToday); startWeek.setDate(startWeek.getDate() - 7);
  if (d >= startToday) return 'Сегодня';
  if (d >= startYest) return 'Вчера';
  if (d >= startWeek) return 'Эта неделя';
  return 'Ранее';
}
const GROUP_ORDER = ['Сегодня', 'Вчера', 'Эта неделя', 'Ранее'];

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
      const update = action === 'accept'
        ? { status: 'active', accepted_at: new Date().toISOString() }
        : { status: 'declined' };
      const { error } = await supabase.from('trip_members').update(update).eq('id', memberId);
      if (error) throw error;
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
    ['all', 'Все'],
    ['unread', `Непрочитанные${unreadCount ? ` · ${unreadCount}` : ''}`],
    ['invites', `Приглашения${inviteCount ? ` · ${inviteCount}` : ''}`],
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>
      <header className="app-header" style={{ position: 'sticky', top: 0, zIndex: 50 }}>
        <button className="app-header__crumb-back" onClick={() => nav('/trips')} title="К трипам">
          <Icon name="back" size={14} />
        </button>
        <div className="app-header__brand" onClick={() => nav('/trips')} style={{ cursor: 'pointer' }}>
          <img src="/triplanio-logo.svg" alt="Triplanio" style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0 }} />
          <span className="app-header__brand-name">Triplanio</span>
        </div>
        <div className="app-header__crumb">
          <span className="app-header__crumb-sep">/</span>
          <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink-2)' }}>Инбокс</span>
        </div>
        <HeaderActions user={user} isPro={isPro} isDark={isDark} onToggleTheme={toggleTheme} />
      </header>

      <main style={{ flex: 1, padding: '32px 24px', maxWidth: 760, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <h1 style={{ flex: 1, marginBottom: 0 }}>Инбокс</h1>
          {unreadCount > 0 && <Btn variant="ghost" size="sm" onClick={() => markAllRead.mutate()}>Пометить всё прочитанным</Btn>}
        </div>

        <div className="tweaks__seg" style={{ marginBottom: 18, display: 'inline-flex' }}>
          {TABS.map(([k, l]) => (
            <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>

        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3, 4].map(i => <Skeleton key={i} w="100%" h={64} r={12} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--muted)' }}>
            <Icon name="bell" size={32} style={{ opacity: 0.4, marginBottom: 10 }} />
            <div style={{ fontSize: 14 }}>{t('notif.empty')}</div>
          </div>
        ) : (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
            {groups.map((g, gi) => (
              <div key={g.label}>
                <div style={{ padding: '10px 18px', fontSize: 11, color: 'var(--muted-2)', letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 600, background: 'var(--wash-2)', borderTop: gi > 0 ? '1px solid var(--line-2)' : 'none', borderBottom: '1px solid var(--line-2)' }}>
                  {g.label}
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
        <div style={{ fontSize: 13.5, lineHeight: 1.45, fontWeight: 500 }}>{titleText}</div>
        {messageText && <div className="muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.4 }}>{messageText}</div>}
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
