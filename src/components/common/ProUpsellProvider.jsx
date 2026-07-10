import React, { createContext, useContext, useState, useCallback } from 'react';
import ProUpsellModal from '@/components/common/ProUpsellModal';

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
  const [state, setState] = useState({ open: false, mode: 'upgrade', feature: '', ownerName: '', onUpgrade: undefined });

  // openProUpsell({ mode?, feature?, ownerName?, onUpgrade? })
  //   mode='info'    → участник: «подключает владелец» + copy-link
  //   mode='upgrade' → владелец/free: фичи + CTA «Перейти к Pro» (onUpgrade)
  const openProUpsell = useCallback((opts = {}) => {
    setState({
      open: true,
      mode: opts.mode || 'upgrade',
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
        mode={state.mode}
        feature={state.feature}
        ownerName={state.ownerName}
        onOpenChange={(o) => { if (!o) closeProUpsell(); }}
        onUpgrade={state.onUpgrade}
      />
    </ProUpsellCtx.Provider>
  );
}
