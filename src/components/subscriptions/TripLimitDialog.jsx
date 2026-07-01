import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/design/icons';
import { Badge, Btn, DialogRoot as Dialog, DialogContent } from '@/design/index';
import { supabase } from '@/api/supabaseClient';
import { useI18n } from '@/lib/i18n/I18nContext';
import { isActiveTripCapReached } from '@/lib/limits';

/**
 * Trip-limit modal (Variant D) - shown for the IN-APP "new trip" action when a
 * free user has hit the 1-active-trip limit. (Direct deep-links to the manual /
 * AI planner show a full-screen blocker instead.)
 *
 * Props:
 *   open, onOpenChange
 *   onProceed              - called when the user is allowed to continue
 *   activeCount, isPro     - pre-computed (preferred); otherwise self-fetched
 */
export default function TripLimitDialog({ open, onOpenChange, onProceed, activeCount: activeCountProp, isPro: isProProp }) {
  const { t } = useI18n();
  const hasPreComputed = typeof activeCountProp === 'number' && typeof isProProp === 'boolean';
  const [state, setState] = useState(() => hasPreComputed
    ? { status: 'ready', activeCount: activeCountProp, isPro: isProProp }
    : { status: 'idle', activeCount: 0, isPro: false }
  );
  const nav = useNavigate();
  const openUpgrade = () => { onOpenChange?.(false); nav('/pro?hidePerTrip=1'); };
  const proceededRef = useRef(false);

  useEffect(() => {
    if (!open) {
      proceededRef.current = false;
      setState(hasPreComputed
        ? { status: 'ready', activeCount: activeCountProp, isPro: isProProp }
        : { status: 'idle', activeCount: 0, isPro: false });
      return;
    }
    if (hasPreComputed) {
      setState({ status: 'ready', activeCount: activeCountProp, isPro: isProProp });
      return;
    }
    let cancelled = false;
    setState(s => ({ ...s, status: 'loading' }));
    (async () => {
      try {
        const res = await supabase.functions.invoke('getActiveTrips', { body: {} });
        if (cancelled) return;
        setState({ status: 'ready', activeCount: res.data?.activeCount || 0, isPro: !!res.data?.isPro });
      } catch (e) {
        console.error(e);
        if (!cancelled) setState({ status: 'ready', activeCount: 0, isPro: false });
      }
    })();
    return () => { cancelled = true; };
  }, [open, hasPreComputed, activeCountProp, isProProp]);

  // Allowed → proceed automatically (in effect, never in render).
  useEffect(() => {
    if (!open || state.status !== 'ready') return;
    const shouldBlock = isActiveTripCapReached(state.isPro, state.activeCount);
    if (!shouldBlock && !proceededRef.current) {
      proceededRef.current = true;
      onProceed?.();
      onOpenChange(false);
    }
  }, [open, state, onProceed, onOpenChange]);

  if (open && state.status !== 'ready') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="dlg--sm">
          <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
            <div className="animate-spin" style={{ width: 24, height: 24, border: '3px solid var(--line)', borderTopColor: 'var(--brand)', borderRadius: '50%' }} />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const shouldBlock = isActiveTripCapReached(state.isPro, state.activeCount);
  if (!shouldBlock) return null;

  const freeRows = [
    { ok: true,  text: t('sub.feat_free_active1') },
    { ok: true,  text: t('sub.feat_free_sections') },
    { ok: false, text: t('sub.feat_unlimited_trips') },
    { ok: false, text: t('sub.feat_ai_parse') },
  ];
  const proRows = [
    <><b>{t('sub.unlimited_word')}</b> {t('sub.feat_unlimited_active_rest')}</>,
    t('sub.feat_ai_recognition'),
    t('sub.feat_all_sections'),
    t('sub.feat_priority_support'),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dlg--wide">
        <div style={{ padding: 20, overflowY: 'auto', maxHeight: 'calc(90vh - 32px)', WebkitOverflowScrolling: 'touch' }}>
          {/* Hero */}
          <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', padding: '22px 24px', marginBottom: 16,
            background: 'linear-gradient(110deg, var(--brand-ink) 0%, var(--brand) 55%, color-mix(in srgb, var(--brand) 55%, white) 120%)', color: 'white' }}>
            <Badge variant="pro" icon="pro" style={{ marginBottom: 10 }}>Pro</Badge>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--fs-h2)', letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: 6 }}>
              {t('sub.limit_hero_title')}
            </div>
            <div style={{ fontSize: 'var(--fs-base)', color: 'rgba(255,255,255,.9)' }}>
              {t('sub.limit_hero_sub', { count: state.activeCount })}
            </div>
          </div>

          {/* Info strip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--wash)', border: '1px solid var(--line-2)', borderRadius: 10, marginBottom: 16, fontSize: 'var(--fs-meta)', color: 'var(--muted)' }}>
            <Icon name="info" size={14} style={{ flexShrink: 0 }} />
            {t('sub.limit_info')}
          </div>

          {/* Two columns */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.06em', color: 'var(--muted)', marginBottom: 12 }}>{t('sub.limit_now_free')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {freeRows.map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-base)', color: r.ok ? 'var(--ink-2)' : 'var(--muted-2)' }}>
                    {r.ok ? <Icon name="check" size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
                          : <Icon name="close" size={14} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />}
                    <span>{r.text}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ border: '1.5px solid var(--pro)', borderRadius: 12, padding: 16, background: 'var(--pro-soft)' }}>
              <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.06em', color: 'var(--pro-ink)', marginBottom: 12 }}>PRO</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {proRows.map((node, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-base)', color: 'var(--ink-2)' }}>
                    <Icon name="check" size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
                    <span>{node}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ textAlign: 'center', fontSize: 'var(--fs-meta)', color: 'var(--muted)', marginTop: 14 }}>
            {t('sub.limit_prices_next')}
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <Btn variant="ghost" onClick={() => onOpenChange(false)}>{t('sub.not_now')}</Btn>
            <Btn variant="pro" icon="crown" onClick={openUpgrade}>{t('sub.see_plans')}</Btn>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
