import React, { createContext, useContext, useState, useCallback } from 'react';
import ProUpsellModal from '@/components/common/ProUpsellModal';
import { track } from '@/lib/analytics';

/**
 * ProUpsellProvider — единый app-level хост Pro-апселла (TRIP-225).
 *
 * Раньше <ProUpsellModal> рендерился с локальным state в четырёх местах
 * (EventEditDialog, TripView, SettingsLens, TripStructureEdit). В EventEditDialog
 * модаль жила внутри глубоко вложенного embedded-инстанса и могла не всплывать
 * (ремаунт/скоуп локального state, вложенные Radix-модалки на мобильном sheet) —
 * кнопка «Pro» выглядела «ничего не делает».
 *
 * Теперь модаль одна, живёт в корне приложения и открывается императивно через
 * `useProUpsell().openProUpsell(...)`. Она никогда не вложена в другую модаль и не
 * пересоздаётся вместе с экраном → апселл всплывает по построению.
 */
const ProUpsellCtx = createContext(null);

export function useProUpsell() {
  const ctx = useContext(ProUpsellCtx);
  if (!ctx) throw new Error('useProUpsell must be used within <ProUpsellProvider>');
  return ctx;
}

export function ProUpsellProvider({ children }) {
  const [state, setState] = useState({ open: false, role: 'owner', source: 'feature', feature: '', ownerName: '', onUpgrade: undefined });

  // openProUpsell({ role, source, feature?, ownerName?, onUpgrade? })
  //   role   — 'owner' | 'member': что человек МОЖЕТ. Решает футер модалки.
  //   source — 'menu' | 'feature': что он СПРАШИВАЕТ. Решает копию.
  // Вызыватель сообщает факты, решение о текстах и кнопках принимает таблица в
  // `@/lib/proUpsell` — иначе каждый экран решает по-своему (так и было: один
  // считал роль, другой всегда слал «участник»).
  const openProUpsell = useCallback((opts = {}) => {
    // central feature-gate impression (Revenue funnel) — the one place the Pro
    // upsell modal opens, so paywall_viewed is captured by construction.
    track('paywall_viewed', { feature: opts.feature || undefined, mode: opts.role || 'owner' });
    setState({
      open: true,
      role: opts.role || 'owner',
      source: opts.source || 'feature',
      feature: opts.feature || '',
      ownerName: opts.ownerName || '',
      onUpgrade: opts.onUpgrade,
    });
  }, []);

  const closeProUpsell = useCallback(() => setState(s => ({ ...s, open: false })), []);

  return (
    <ProUpsellCtx.Provider value={{ openProUpsell, closeProUpsell }}>
      {children}
      <ProUpsellModal
        open={state.open}
        role={state.role}
        source={state.source}
        feature={state.feature}
        ownerName={state.ownerName}
        onOpenChange={(o) => { if (!o) closeProUpsell(); }}
        onUpgrade={state.onUpgrade}
      />
    </ProUpsellCtx.Provider>
  );
}
