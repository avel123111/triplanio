import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { useT, useI18n } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import { formatDistanceToNowStrict } from 'date-fns';
import { ru, es, enUS } from 'date-fns/locale';
import { Icon } from '@/design/icons';
import { Btn } from '@/design/index';

const DATE_LOCALES = { ru, es, en: enUS };

// Icon + accent colour for a notification, by type.
export function notifMeta(type = '') {
  const tp = String(type).toLowerCase();
  if (tp.includes('invite')) return { icon: 'users', color: 'var(--brand)' };
  if (tp.includes('vote') || tp.includes('hotel')) return { icon: 'vote', color: 'var(--ai)' };
  if (tp.includes('pro') || tp.includes('subscription') || tp.includes('payment')) return { icon: 'pro', color: 'var(--warm)' };
  if (tp.includes('join') || tp.includes('member')) return { icon: 'user', color: 'var(--success)' };
  if (tp.includes('activity') || tp.includes('update') || tp.includes('edit')) return { icon: 'edit', color: 'var(--warm)' };
  return { icon: 'bell', color: 'var(--brand)' };
}

export default function NotificationsBell({ triggerClassName }) {
  const t = useT();
  const { lang } = useI18n();
  const dateLocale = DATE_LOCALES[lang] || enUS;
  const qc = useQueryClient();
  const { user } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications', user?.email],
    queryFn: async () => {
      if (!user?.email) return [];
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.email,
    refetchInterval: 60_000,
  });

  const unread = notifications.filter(n => !n.read).length;

  const markAllRead = useMutation({
    mutationFn: async () => {
      const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
      if (!unreadIds.length) return;
      const { error } = await supabase.from('notifications').update({ read: true }).in('id', unreadIds);
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
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['trips'] });
      qc.invalidateQueries({ queryKey: ['trip-members'] });
      qc.invalidateQueries({ queryKey: ['trip-member', vars?.memberId] });
    },
  });

  const markOneRead = useMutation({
    mutationFn: async (notifId) => {
      const { error } = await supabase.from('notifications').update({ read: true }).eq('id', notifId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (!user) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('notif.title')}
          className={triggerClassName
            ? `relative ${triggerClassName}`
            : 'relative inline-flex items-center justify-center h-10 w-10 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition'}
        >
          <Icon name="bell" size={17} />
          {unread > 0 && <span className="dot" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="p-0 w-[360px] max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl">
        <div className="bell-dd__head">
          <Icon name="bell" size={16} />
          <div style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{t('notif.title')}</div>
          {unread > 0 && (
            <button onClick={() => markAllRead.mutate()}
              style={{ background: 'transparent', border: 'none', color: 'var(--brand)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
              {t('notif.mark_all_read')}
            </button>
          )}
        </div>

        <div className="bell-dd__list scrollbar-thin">
          {isLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '28px 0', color: 'var(--muted)' }}>
              <Icon name="refresh" size={16} />
            </div>
          ) : notifications.length === 0 ? (
            <div style={{ padding: '36px 22px 26px', textAlign: 'center' }}>
              <div style={{
                width: 60, height: 60, margin: '0 auto 14px',
                borderRadius: 16,
                background: 'linear-gradient(135deg, var(--brand-soft), var(--wash))',
                color: 'var(--brand)',
                display: 'grid', placeItems: 'center',
                position: 'relative',
              }}>
                <Icon name="bell" size={26} />
                <span style={{
                  position: 'absolute', bottom: 2, right: 2,
                  width: 20, height: 20, borderRadius: '50%',
                  background: 'var(--success)', color: 'white',
                  display: 'grid', placeItems: 'center',
                  border: '2.5px solid var(--surface)',
                }}>
                  <Icon name="check" size={10} />
                </span>
              </div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>Всё прочитано</div>
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.55, maxWidth: 240, margin: '0 auto' }}>
                Никаких новых приглашений, голосований и правок. Если кто-то добавит тебя в трип — увидишь здесь.
              </div>
            </div>
          ) : (
            notifications.map(n => (
              <NotifRow
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
                onOpenTrip={() => { setOpen(false); }}
              />
            ))
          )}
        </div>

        <div className="bell-dd__foot">
          <button
            onClick={() => { setOpen(false); nav('/inbox'); }}
            style={{ background: 'transparent', border: 'none', color: 'var(--brand)', fontSize: 13, fontWeight: 500, cursor: 'pointer', padding: '4px 8px' }}
          >
            Открыть инбокс целиком →
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotifRow({ n, t, dateLocale, pending, onRespond, onMarkRead, onOpenTrip }) {
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
    const resolved = { ...params };
    if (resolved.role_key) { resolved.role = t(resolved.role_key); delete resolved.role_key; }
    return resolved;
  };
  const titleText = n.i18n_title_key ? t(n.i18n_title_key, renderParams(n.i18n_params)) : n.title;
  const messageText = n.i18n_message_key ? t(n.i18n_message_key, renderParams(n.i18n_params)) : n.message;

  const meta = notifMeta(n.type);
  const showPending = isInvite && member?.status === 'pending';

  return (
    <div
      onClick={() => { if (!n.read) onMarkRead?.(); }}
      style={{
        display: 'flex', gap: 10, padding: '12px 14px',
        borderBottom: '1px solid var(--line-2)',
        background: n.read ? 'transparent' : 'var(--brand-soft)',
        cursor: n.read ? 'default' : 'pointer',
      }}
    >
      <div style={{ width: 30, height: 30, borderRadius: 8, background: `color-mix(in oklab, ${meta.color} 14%, transparent)`, color: meta.color, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon name={meta.icon} size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, lineHeight: 1.4, fontWeight: 500 }}>{titleText}</div>
        {messageText && <div className="muted" style={{ fontSize: 11.5, marginTop: 2, lineHeight: 1.4 }}>{messageText}</div>}
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{time}</div>

        {showPending && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <Btn variant="primary" size="sm" icon="check" disabled={pending} onClick={() => onRespond('accept')}>{t('notif.accept')}</Btn>
            <Btn variant="ghost" size="sm" disabled={pending} onClick={() => onRespond('decline')}>{t('notif.decline')}</Btn>
          </div>
        )}
        {isInvite && member?.status === 'active' && (
          <div style={{ fontSize: 11.5, color: 'var(--success)', marginTop: 4 }}>✓ {t('notif.accepted')}</div>
        )}

        {n.trip_id && (member?.status === 'active' || n.type !== 'trip_invite') && (
          <Link to={`/trip/${n.trip_id}`} onClick={onOpenTrip}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--brand)', fontWeight: 500, marginTop: 6 }}>
            <Icon name="pin" size={12} />{t('notif.view_trip')}
          </Link>
        )}
      </div>
    </div>
  );
}
