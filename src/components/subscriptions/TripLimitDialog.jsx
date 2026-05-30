import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Crown, Check, X, Info } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';

/**
 * Trip-limit modal (Variant D) — shown for the IN-APP "new trip" action when a
 * free user has hit the 1-active-trip limit. (Direct deep-links to the manual /
 * AI planner show a full-screen blocker instead.)
 *
 * Props:
 *   open, onOpenChange
 *   onProceed              — called when the user is allowed to continue
 *   activeCount, isPro     — pre-computed (preferred); otherwise self-fetched
 */
export default function TripLimitDialog({ open, onOpenChange, onProceed, activeCount: activeCountProp, isPro: isProProp }) {
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
    const shouldBlock = !state.isPro && state.activeCount >= 1;
    if (!shouldBlock && !proceededRef.current) {
      proceededRef.current = true;
      onProceed?.();
      onOpenChange(false);
    }
  }, [open, state, onProceed, onOpenChange]);

  if (open && state.status !== 'ready') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
        </DialogContent>
      </Dialog>
    );
  }

  const shouldBlock = !state.isPro && state.activeCount >= 1;
  if (!shouldBlock) return null;

  const freeRows = [
    { ok: true,  text: '1 активный трип' },
    { ok: true,  text: 'Все основные линзы' },
    { ok: false, text: 'Безлимит трипов' },
    { ok: false, text: 'ИИ-парсинг броней' },
  ];
  const proRows = [
    <><b>Безлимит</b> активных трипов</>,
    'ИИ-распознавание броней',
    'Все линзы во всех трипах',
    'Приоритетная поддержка',
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <div style={{ padding: 20 }}>
          {/* Hero */}
          <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', padding: '22px 24px', marginBottom: 16,
            background: 'linear-gradient(110deg, var(--brand-ink, #1b3a8f) 0%, var(--brand, #2167e2) 55%, #6aa0ff 120%)', color: 'white' }}>
            <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', background: 'rgba(255,255,255,.18)', padding: '2px 9px', borderRadius: 999, marginBottom: 10 }}>Pro</span>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em', lineHeight: 1.1, marginBottom: 6 }}>
              Планируй сколько угодно трипов.
            </div>
            <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,.9)' }}>
              Ты достиг лимита Free — {state.activeCount} активный трип. Pro снимает ограничение.
            </div>
          </div>

          {/* Info strip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--wash)', border: '1px solid var(--line-2)', borderRadius: 10, marginBottom: 16, fontSize: 12.5, color: 'var(--muted)' }}>
            <Info className="w-3.5 h-3.5 shrink-0" />
            Трип активен до последнего дня — прошедшие трипы освобождают слот автоматически.
          </div>

          {/* Two columns */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--muted)', marginBottom: 12 }}>СЕЙЧАС · FREE</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {freeRows.map((r, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: r.ok ? 'var(--ink-2)' : 'var(--muted-2)' }}>
                    {r.ok ? <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--success)' }} />
                          : <X className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--muted-2)' }} />}
                    <span>{r.text}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ border: '1.5px solid var(--warm)', borderRadius: 12, padding: 16, background: 'var(--warm-tint)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--warm)', marginBottom: 12 }}>PRO</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {proRows.map((node, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-2)' }}>
                    <Check className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--success)' }} />
                    <span>{node}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', marginTop: 14 }}>
            Тарифы и цены — на следующем экране.
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Не сейчас</Button>
            <Button onClick={openUpgrade}><Crown className="w-4 h-4 mr-2" />Посмотреть тарифы</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
