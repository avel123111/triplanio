import React, { useMemo, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Bell, Mail, Send, ShieldAlert, Loader2 } from 'lucide-react';
import { NOTIFICATIONS, CHANNELS } from '@/lib/notifications-catalog';
import { useT } from '@/lib/i18n/I18nContext';

const ICONS = { Bell, Mail, Send };

/**
 * Admin-only registry of every notification the app can send.
 * The data comes from the static catalog at lib/notifications-catalog.js —
 * developers maintain it manually when adding/changing notifications.
 */
export default function AdminNotificationsPage() {
  const t = useT();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    base44.auth.me()
      .then((u) => { if (!cancelled) { setUser(u); setLoading(false); } })
      .catch(() => { if (!cancelled) { setUser(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (channelFilter === 'all') return NOTIFICATIONS;
    return NOTIFICATIONS.filter((n) => n.channel === channelFilter);
  }, [channelFilter]);

  const counts = useMemo(() => {
    const c = { all: NOTIFICATIONS.length };
    for (const n of NOTIFICATIONS) c[n.channel] = (c[n.channel] || 0) + 1;
    return c;
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (user?.role !== 'admin') {
    return (
      <div className="max-w-md mx-auto mt-16 p-6 rounded-2xl border bg-card text-center">
        <ShieldAlert className="w-10 h-10 mx-auto text-destructive mb-3" />
        <h2 className="font-display text-xl font-bold mb-1">{t('admin.notifications.forbidden_title')}</h2>
        <p className="text-sm text-muted-foreground mb-4">{t('admin.notifications.forbidden_desc')}</p>
        <button
          onClick={() => navigate('/')}
          className="text-sm text-primary hover:underline"
        >
          {t('admin.notifications.back_home')}
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold">{t('admin.notifications.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('admin.notifications.subtitle')}</p>
      </div>

      {/* Channel filter pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        <FilterPill
          active={channelFilter === 'all'}
          onClick={() => setChannelFilter('all')}
          label={`${t('admin.notifications.filter_all')} (${counts.all})`}
        />
        {Object.entries(CHANNELS).map(([key, meta]) => (
          <FilterPill
            key={key}
            active={channelFilter === key}
            onClick={() => setChannelFilter(key)}
            label={`${meta.label} (${counts[key] || 0})`}
            iconName={meta.icon}
          />
        ))}
      </div>

      {/* List */}
      <div className="space-y-3">
        {filtered.map((n) => (
          <NotificationCard key={n.id} notif={n} />
        ))}
      </div>
    </div>
  );
}

function FilterPill({ active, onClick, label, iconName }) {
  const Icon = iconName ? ICONS[iconName] : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition ${
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-card text-foreground border-border hover:bg-secondary'
      }`}
    >
      {Icon && <Icon className="w-3.5 h-3.5" />}
      {label}
    </button>
  );
}

function NotificationCard({ notif }) {
  const t = useT();
  const channel = CHANNELS[notif.channel] || { label: notif.channel, icon: 'Bell', color: '' };
  const Icon = ICONS[channel.icon] || Bell;

  return (
    <div className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${channel.color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${channel.color}`}>
              {channel.label}
            </span>
            <code className="text-xs text-muted-foreground font-mono">{notif.id}</code>
          </div>
          <div className="font-semibold mt-1.5">{notif.trigger}</div>
          {notif.comment && (
            <div className="text-sm text-muted-foreground mt-1">{notif.comment}</div>
          )}

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-3 text-sm">
            <Field label={t('admin.notifications.when')} value={notif.when} />
            <Field label={t('admin.notifications.audience')} value={notif.audience} align="right" />
            <Field label={t('admin.notifications.source')} value={<code className="text-xs">{notif.source}</code>} fullWidth />
          </dl>

          {notif.i18nKeys && (
            <div className="mt-3 text-xs">
              <div className="text-muted-foreground mb-1">{t('admin.notifications.i18n_keys')}</div>
              <div className="flex flex-wrap gap-1.5">
                {notif.i18nKeys.title && (
                  <code className="px-2 py-0.5 rounded bg-secondary font-mono">{notif.i18nKeys.title}</code>
                )}
                {notif.i18nKeys.message && (
                  <code className="px-2 py-0.5 rounded bg-secondary font-mono">{notif.i18nKeys.message}</code>
                )}
              </div>
            </div>
          )}

          {notif.hardcodedText && (
            <div className="mt-3 text-xs">
              <div className="text-muted-foreground mb-1">{t('admin.notifications.hardcoded_text')}</div>
              <div className="space-y-2">
                {Object.entries(notif.hardcodedText).map(([lang, txt]) => (
                  <div key={lang} className="flex gap-2 items-start min-w-0">
                    <code className="text-[10px] uppercase font-mono text-muted-foreground shrink-0 mt-0.5">{lang}</code>
                    <span className="min-w-0 break-words whitespace-pre-wrap">{txt}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, fullWidth = false, align = 'left' }) {
  return (
    <div className={`${fullWidth ? 'sm:col-span-2' : ''} ${align === 'right' ? 'sm:text-right' : ''}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">{value}</dd>
    </div>
  );
}