import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Check, Crown, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import UpgradePlanDialog from './UpgradePlanDialog';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Asks the user to upgrade when they've hit the free plan's active-trip limit.
 *
 * Two modes:
 *   - PRE-COMPUTED (preferred): caller passes `activeCount` and `isPro` props.
 *     We use them immediately — no network call, no spinner. This is what the
 *     Trips page does, since it already has both numbers loaded.
 *   - SELF-FETCH (legacy): if no props are passed, fetch via getActiveTrips on
 *     open. Slower, kept for any caller that doesn't have the data on hand.
 */
export default function TripLimitDialog({ open, onOpenChange, onProceed, activeCount: activeCountProp, isPro: isProProp }) {
  const t = useT();
  const hasPreComputed = typeof activeCountProp === 'number' && typeof isProProp === 'boolean';

  const [state, setState] = useState(() => hasPreComputed
    ? { status: 'ready', activeCount: activeCountProp, isPro: isProProp }
    : { status: 'idle', activeCount: 0, isPro: false }
  );
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Guard so we never fire onProceed twice (e.g. on a re-render)
  const proceededRef = useRef(false);

  // Load fresh limit info whenever the dialog opens (only when not pre-computed)
  useEffect(() => {
    if (!open) {
      // Reset so the next open re-fetches and the proceed guard resets
      proceededRef.current = false;
      setState(hasPreComputed
        ? { status: 'ready', activeCount: activeCountProp, isPro: isProProp }
        : { status: 'idle', activeCount: 0, isPro: false }
      );
      return;
    }

    if (hasPreComputed) {
      // Refresh from props in case parent re-rendered with new values.
      setState({ status: 'ready', activeCount: activeCountProp, isPro: isProProp });
      return;
    }

    let cancelled = false;
    setState(s => ({ ...s, status: 'loading' }));
    (async () => {
      try {
        const res = await base44.functions.invoke('getActiveTrips', {});
        if (cancelled) return;
        setState({
          status: 'ready',
          activeCount: res.data?.activeCount || 0,
          isPro: !!res.data?.isPro,
        });
      } catch (e) {
        console.error(e);
        if (!cancelled) setState({ status: 'ready', activeCount: 0, isPro: false });
      }
    })();
    return () => { cancelled = true; };
  }, [open, hasPreComputed, activeCountProp, isProProp]);

  // When ready: if user is allowed → proceed automatically (in effect, not in render!)
  useEffect(() => {
    if (!open || state.status !== 'ready') return;
    const shouldBlock = !state.isPro && state.activeCount >= 1;
    if (!shouldBlock && !proceededRef.current) {
      proceededRef.current = true;
      onProceed?.();
      onOpenChange(false);
    }
  }, [open, state, onProceed, onOpenChange]);

  // Loading spinner while we check
  if (open && state.status !== 'ready') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Allowed → don't render anything (effect already closed the dialog)
  const shouldBlock = !state.isPro && state.activeCount >= 1;
  if (!shouldBlock) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <div className="flex justify-center mb-4">
            <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-950/30 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-amber-600" />
            </div>
          </div>

          <DialogHeader className="text-center sm:text-center">
            <DialogTitle className="text-xl font-bold text-center">{t('sub.limit_title')}</DialogTitle>
            <DialogDescription className="text-center text-sm mt-2">
              {t('sub.limit_desc', { count: state.activeCount })}
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 px-4">
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              {t('sub.limit_hint')}
            </p>

            <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Crown className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-base">{t('sub.pro_title')}</h3>
                  <p className="text-xs text-muted-foreground">{t('sub.pro_subtitle')}</p>
                </div>
              </div>

              <div className="space-y-2 border-t border-primary/20 pt-3">
                <div className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                  <span className="text-sm">{t('sub.feat_price')}</span>
                </div>
                <div className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                  <span className="text-sm">{t('sub.feat_ai_all')}</span>
                </div>
                <div className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                  <span className="text-sm">{t('sub.feat_cancel')}</span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('sub.go_to_trips')}
            </Button>
            <Button onClick={() => setUpgradeOpen(true)}>
              <Crown className="w-4 h-4 mr-2" />
              {t('sub.go_pro')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UpgradePlanDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        hidePerTrip
      />
    </>
  );
}