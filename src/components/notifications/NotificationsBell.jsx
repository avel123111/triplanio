import React, { useState } from 'react';
import { Bell, Loader2, Check, X as XIcon, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
// Note: Button is still used inside NotificationItem for Accept/Decline actions.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { useT, useI18n } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import { Link } from 'react-router-dom';
import { formatDistanceToNowStrict } from 'date-fns';
import { ru, es, enUS } from 'date-fns/locale';

const DATE_LOCALES = { ru, es, en: enUS };

export default function NotificationsBell() {
  const t = useT();
  const { lang } = useI18n();
  const dateLocale = DATE_LOCALES[lang] || enUS;
  const qc = useQueryClient();
  const { user } = useAuth();
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
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .in('id', unreadIds);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const respondInvite = useMutation({
    mutationFn: async ({ memberId, action }) => {
      const update = action === 'accept'
        ? { status: 'active', accepted_at: new Date().toISOString() }
        : { status: 'declined' };
      const { error } = await supabase
        .from('trip_members')
        .update(update)
        .eq('id', memberId);
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['trips'] });
      qc.invalidateQueries({ queryKey: ['trip-members'] });
      qc.invalidateQueries({ queryKey: ['trip-member', vars?.memberId] });
    },
  });

  // Mark a single notification as read
  const markOneRead = useMutation({
    mutationFn: async (notifId) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notifId);
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
          className="relative inline-flex items-center justify-center h-10 w-10 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition"
        >
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0 max-h-[80vh] overflow-y-auto">
        <div className="px-4 py-3 border-b flex items-center justify-between sticky top-0 bg-popover">
          <div className="font-semibold text-sm">{t('notif.title')}</div>
          {unread > 0 && (
            <button onClick={() => markAllRead.mutate()} className="text-xs text-primary hover:underline">
              {t('notif.mark_all_read')}
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-10 px-4">
            <Bell className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
            <div className="text-sm text-muted-foreground">{t('notif.empty')}</div>
          </div>
        ) : (
          <div className="divide-y">
            {notifications.map(n => (
              <NotificationItem
                key={n.id}
                notification={n}
                onRespond={(action) => {
                  // Responding to an invite implicitly marks the notification
                  // as read — we don't need a separate click.
                  if (!n.read) markOneRead.mutate(n.id);
                  respondInvite.mutate({ memberId: n.trip_member_id, action });
                }}
                onMarkRead={() => { if (!n.read) markOneRead.mutate(n.id); }}
                onClose={() => setOpen(false)}
                t={t}
                dateLocale={dateLocale}
                pending={respondInvite.isPending}
              />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function NotificationItem({ notification: n, onRespond, onMarkRead, onClose, t, dateLocale, pending }) {
  const isInvite = n.type === 'trip_invite' && n.trip_member_id;
  // We need to know if the invite is still pending — fetch the member status
  const { data: member } = useQuery({
    queryKey: ['trip-member', n.trip_member_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trip_members')
        .select('*')
        .eq('id', n.trip_member_id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!isInvite,
  });

  const time = n.created_at ? formatDistanceToNowStrict(new Date(n.created_at), { addSuffix: true, locale: dateLocale }) : '';

  // Translate dynamic notifications via i18n keys + params when present.
  // Falls back to the legacy pre-rendered title/message stored on the row.
  const renderParams = (params = {}) => {
    const resolved = { ...params };
    // role_key holds another translation key (e.g. notif.role_admin) — resolve it.
    if (resolved.role_key) {
      resolved.role = t(resolved.role_key);
      delete resolved.role_key;
    }
    return resolved;
  };
  const titleText = n.i18n_title_key
    ? t(n.i18n_title_key, renderParams(n.i18n_params))
    : n.title;
  const messageText = n.i18n_message_key
    ? t(n.i18n_message_key, renderParams(n.i18n_params))
    : n.message;

  // Clicking anywhere on the notification body marks it as read — but only
  // when it's currently unread, to avoid extra writes. We intentionally exclude
  // the Accept/Decline buttons (they have their own onRespond handler).
  const handleBodyClick = () => {
    if (!n.read) onMarkRead?.();
  };

  return (
    <div
      className={`p-3 transition-colors ${n.read ? '' : 'bg-primary/5 cursor-pointer hover:bg-primary/10'}`}
      onClick={handleBodyClick}
    >
      <div className="flex items-start gap-2">
        {!n.read && <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">{titleText}</div>
          {messageText && <div className="text-xs text-muted-foreground mt-0.5">{messageText}</div>}
          <div className="text-[10px] text-muted-foreground mt-1">{time}</div>

          {isInvite && member?.status === 'pending' && (
            <div className="flex gap-2 mt-2">
              <Button size="sm" disabled={pending} onClick={() => onRespond('accept')} className="h-7 text-xs">
                <Check className="w-3 h-3 mr-1" />{t('notif.accept')}
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => onRespond('decline')} className="h-7 text-xs">
                <XIcon className="w-3 h-3 mr-1" />{t('notif.decline')}
              </Button>
            </div>
          )}
          {isInvite && member?.status === 'active' && (
            <div className="text-xs text-green-600 mt-1">✓ {t('notif.accepted')}</div>
          )}
          {isInvite && member?.status === 'declined' && (
            <div className="text-xs text-muted-foreground mt-1">{t('notif.declined')}</div>
          )}

          {n.trip_id && (member?.status === 'active' || n.type !== 'trip_invite') && (
            <Link to={`/trip/${n.trip_id}`} onClick={onClose} className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1.5">
              <MapPin className="w-3 h-3" />{t('notif.view_trip')}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}