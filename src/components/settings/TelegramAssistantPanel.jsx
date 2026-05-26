import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Loader2, ExternalLink, Check, Send } from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';
import ConfirmDialog from '@/components/common/ConfirmDialog';

/**
 * Expandable settings panel for the TELEGRAM_ASSISTANT addon.
 * Binds a user's Telegram chat to this trip so they can receive reminders
 * (hotels, transfers, activities, car rentals). No LLM / chat with assistant —
 * the webhook only handles the /start handshake for chat binding.
 */
export default function TelegramAssistantPanel({ tripId }) {
  const t = useT();
  const qc = useQueryClient();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertText, setAlertText] = useState('');

  const showAlert = (text) => { setAlertText(text); setAlertOpen(true); };

  const { data, isLoading } = useQuery({
    queryKey: ['telegram-integration', tripId],
    queryFn: async () => {
      const res = await base44.functions.invoke('telegramGetIntegration', { tripId });
      return res.data;
    },
    enabled: !!tripId,
  });

  const connectMut = useMutation({
    mutationFn: async () => {
      const res = await base44.functions.invoke('telegramStartLink', { tripId });
      return res.data;
    },
    onSuccess: (d) => {
      if (d?.url) {
        window.open(d.url, '_blank', 'noopener,noreferrer');
        // Refresh status after a delay so the panel updates once /start completes.
        setTimeout(() => qc.invalidateQueries({ queryKey: ['telegram-integration', tripId] }), 5000);
      }
    },
    onError: (err) => showAlert(err?.response?.data?.error || err.message),
  });

  const toggleMut = useMutation({
    mutationFn: (isActive) => base44.functions.invoke('telegramSetActive', { tripId, isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['telegram-integration', tripId] }),
  });

  const disconnectMut = useMutation({
    mutationFn: () => base44.functions.invoke('telegramDisconnect', { tripId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['telegram-integration', tripId] }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  const connected = !!data?.connected;
  const integ = data?.integration;
  const displayName = integ?.telegram_username
    ? `@${integ.telegram_username}`
    : integ?.telegram_first_name || t('telegram.unknown_user');

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground leading-relaxed">
        {t('telegram.panel_hint')}
      </div>

      {!connected ? (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300 flex items-center justify-center shrink-0">
              <Send className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">{t('telegram.not_connected_title')}</div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                {t('telegram.not_connected_desc')}
              </p>
              <Button
                size="sm"
                className="mt-3"
                onClick={() => connectMut.mutate()}
                disabled={connectMut.isPending}
              >
                {connectMut.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                )}
                {t('telegram.connect_btn')}
              </Button>
              <p className="text-[11px] text-muted-foreground mt-2">
                {t('telegram.connect_after_hint')}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300 flex items-center justify-center shrink-0">
              <Check className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">{t('telegram.connected_title')}</div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{displayName}</p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-3 border-t">
            <div>
              <div className="text-sm font-semibold">{t('telegram.notifications')}</div>
              <p className="text-xs text-muted-foreground mt-0.5">{t('telegram.notifications_hint')}</p>
            </div>
            <Switch
              checked={!!integ?.is_active}
              onCheckedChange={(v) => toggleMut.mutate(v)}
              disabled={toggleMut.isPending}
            />
          </div>

          <div className="pt-3 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDisconnect(true)}
              disabled={disconnectMut.isPending}
            >
              {disconnectMut.isPending && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              {t('telegram.disconnect_btn')}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title={t('telegram.disconnect_confirm_title')}
        description={t('telegram.disconnect_confirm_desc')}
        confirmLabel={t('telegram.disconnect_btn')}
        variant="destructive"
        onConfirm={() => { disconnectMut.mutate(); setConfirmDisconnect(false); }}
      />

      <ConfirmDialog
        open={alertOpen}
        onOpenChange={setAlertOpen}
        title={t('common.notice')}
        description={alertText}
        singleButton
      />
    </div>
  );
}