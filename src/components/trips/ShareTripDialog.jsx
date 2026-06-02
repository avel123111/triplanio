import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Share2, Copy, Check, Loader2 } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Share trip dialog - shows a public read-only link.
 * Opens immediately; the link is fetched asynchronously while a spinner is shown.
 */
export default function ShareTripDialog({ open, onOpenChange, tripId }) {
  const t = useT();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !tripId) return;
    setUrl('');
    setCopied(false);
    setLoading(true);
    supabase.functions.invoke('ensureShareToken', { body: { tripId } })
      .then(({ data, error }) => {
        if (error) { console.error('ensureShareToken error:', error); return; }
        const token = data?.shareToken || data?.token;
        if (token) {
          setUrl(`${window.location.origin}/public/trip/${tripId}?t=${token}`);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [open, tripId]);

  const handleCopy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[calc(100vw-2rem)] overflow-hidden">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Share2 className="w-5 h-5 text-primary" />
            </div>
            <DialogTitle className="font-display text-xl">
              {t('share.dialog_title')}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-3">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
            {t('share.link_label')}
          </div>

          <div className="flex gap-2 w-full">
            <input
              readOnly
              value={loading ? '' : url}
              placeholder={loading ? t('share.generating') : ''}
              className="flex-1 min-w-0 w-full border border-input bg-background px-3 py-2 text-xs font-mono text-foreground truncate rounded-md" />
            
            <Button
              onClick={handleCopy}
              disabled={!url || loading}
              className="shrink-0 gap-1.5 rounded-md">
              
              {copied ?
              <Check className="w-4 h-4" /> :
              <Copy className="w-4 h-4" />}
              {copied ? t('share.copied') : t('share.copy')}
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            {t('share.description')}
          </p>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>);

}