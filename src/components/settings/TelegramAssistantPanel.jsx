import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@/components/ui/alert-dialog';
import { Loader2, ExternalLink, Check, Send, Trash2, Plus, Copy } from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';
import ConfirmDialog from '@/components/common/ConfirmDialog';

/**
 * Telegram multi-account panel.
 *
 * A trip can bind SEVERAL Telegram chats (many-to-many trip ↔ chat_id). Each
 * binding is one row in trip_telegram_integrations, identified by id.
 *
 * Flow:
 *   telegramStartLink  → { url }            (one-time deep link, 10 min)
 *   user presses Start → n8n → telegramWebhook upserts the binding
 *   telegramGetIntegration → { integrations: [...] }   (polled while waiting)
 *   telegramSetActive  { tripId, integrationId, isActive }
 *   telegramDisconnect { tripId, integrationId }
 */
export default function TelegramAssistantPanel({ tripId }) {
  const t = useT();
  const qc = useQueryClient();

  const [connectOpen, setConnectOpen] = useState(false);
  const [connectStage, setConnectStage] = useState('idle'); // 'idle' | 'waiting' | 'connected'
  const [linkUrl, setLinkUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [alertText, setAlertText] = useState('');
  const baselineRef = useRef(0);

  const queryKey = ['telegram-integrations', tripId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await supabase.functions.invoke('telegramGetIntegration', { body: { tripId } });
      if (res.error) throw res.error;
      return res.data; // { integrations: [...] }
    },
    enabled: !!tripId,
    // Poll only while the connect dialog is waiting for the user to press Start.
    refetchInterval: connectOpen && connectStage === 'waiting' ? 3000 : false,
  });

  const integrations = data?.integrations ?? [];

  // A new binding appeared while waiting → switch the dialog to "connected".
  useEffect(() => {
    if (connectOpen && connectStage === 'waiting' && integrations.length > baselineRef.current) {
      setConnectStage('connected');
    }
  }, [integrations.length, connectOpen, connectStage]);

  const connectMut = useMutation({
    mutationFn: async () => {
      const res = await supabase.functions.invoke('telegramStartLink', { body: { tripId } });
      if (res.error) throw res.error;
      return res.data; // { url }
    },
    onMutate: () => { baselineRef.current = integrations.length; },
    onSuccess: (d) => {
      if (!d?.url) { setAlertText(t('telegram.connect_error')); return; }
      setLinkUrl(d.url);
      setConnectStage('waiting');
      setConnectOpen(true);
      // Best-effort auto-open; the dialog also has an explicit "Open bot" button
      // (popup blockers may stop this async open — the button is the fallback).
      window.open(d.url, '_blank', 'noopener,noreferrer');
    },
    onError: (err) => setAlertText(err?.message || t('telegram.connect_error')),
  });

  const toggleMut = useMutation({
    mutationFn: ({ integrationId, isActive }) =>
      supabase.functions.invoke('telegramSetActive', { body: { tripId, integrationId, isActive } }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const disconnectMut = useMutation({
    mutationFn: (integrationId) =>
      supabase.functions.invoke('telegramDisconnect', { body: { tripId, integrationId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const closeConnect = () => {
    setConnectOpen(false);
    setConnectStage('idle');
    setLinkUrl('');
    qc.invalidateQueries({ queryKey });
  };

  const copyLink = () => {
    navigator.clipboard?.writeText(linkUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const displayName = (i) =>
    i.telegram_first_name
    || (i.telegram_username ? `@${i.telegram_username}` : t('telegram.unknown_user'));

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground leading-relaxed">{t('telegram.panel_hint')}</div>

      {integrations.length === 0 ? (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300 flex items-center justify-center shrink-0">
              <Send className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">{t('telegram.not_connected_title')}</div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{t('telegram.not_connected_desc')}</p>
              <Button size="sm" className="mt-3" onClick={() => connectMut.mutate()} disabled={connectMut.isPending}>
                {connectMut.isPending
                  ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  : <ExternalLink className="w-3.5 h-3.5 mr-1.5" />}
                {t('telegram.connect_btn')}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {integrations.map((i) => (
            <div key={i.id} className="rounded-lg border bg-card p-3 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300 flex items-center justify-center shrink-0">
                <Send className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm truncate">{displayName(i)}</div>
                {i.telegram_username && i.telegram_first_name && (
                  <div className="text-xs text-muted-foreground font-mono truncate">@{i.telegram_username}</div>
                )}
              </div>
              <Switch
                checked={!!i.is_active}
                onCheckedChange={(v) => toggleMut.mutate({ integrationId: i.id, isActive: v })}
                disabled={toggleMut.isPending}
              />
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-destructive px-2"
                onClick={() => setRemoveTarget(i)}
                disabled={disconnectMut.isPending}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => connectMut.mutate()} disabled={connectMut.isPending}>
            {connectMut.isPending
              ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              : <Plus className="w-3.5 h-3.5 mr-1.5" />}
            {t('telegram.connect_another')}
          </Button>
        </div>
      )}

      {/* Connect dialog (link → waiting → connected) */}
      <AlertDialog open={connectOpen} onOpenChange={(o) => { if (!o) closeConnect(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {connectStage === 'connected' ? t('telegram.connected_title') : t('telegram.connect_title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {connectStage === 'connected' ? t('telegram.connect_success_desc') : t('telegram.connect_dialog_desc')}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {connectStage !== 'connected' && (
            <div className="space-y-3">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  {t('telegram.link_label')}
                </div>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={linkUrl}
                    className="flex-1 text-xs font-mono rounded-md border bg-muted px-2 py-1.5 truncate"
                  />
                  <Button variant="outline" size="sm" onClick={copyLink}>
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>
              <Button className="w-full" onClick={() => window.open(linkUrl, '_blank', 'noopener,noreferrer')}>
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                {t('telegram.open_bot')}
              </Button>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t('telegram.waiting_hint')}
              </div>
            </div>
          )}

          <AlertDialogFooter>
            {connectStage === 'connected' ? (
              <Button onClick={closeConnect}>
                <Check className="w-3.5 h-3.5 mr-1.5" />
                {t('common.ok')}
              </Button>
            ) : (
              <Button variant="ghost" onClick={closeConnect}>{t('common.close')}</Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove-account confirm */}
      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(o) => { if (!o) setRemoveTarget(null); }}
        title={t('telegram.disconnect_confirm_title')}
        description={t('telegram.disconnect_confirm_desc')}
        confirmLabel={t('telegram.disconnect_btn')}
        variant="destructive"
        onConfirm={() => { if (removeTarget) disconnectMut.mutate(removeTarget.id); setRemoveTarget(null); }}
      />

      {/* Error alert */}
      <ConfirmDialog
        open={!!alertText}
        onOpenChange={(o) => { if (!o) setAlertText(''); }}
        title={t('common.notice')}
        description={alertText}
        singleButton
      />
    </div>
  );
}
