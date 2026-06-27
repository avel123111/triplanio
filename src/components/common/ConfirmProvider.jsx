import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import ConfirmDialog from '@/components/common/ConfirmDialog';

/**
 * App-wide promise-based confirm/alert, layered on the canonical ConfirmDialog
 * (Radix ui/alert-dialog, token-styled). Replaces native window.confirm()/alert()
 * so every confirmation across the app shares one accessible, themed primitive.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: t('…'), variant: 'destructive' }))) return;
 *   // info-only:
 *   await confirm({ title: t('…'), singleButton: true });
 *
 *   // async action — the dialog keeps a spinner on the confirm button and stays
 *   // open until the work resolves (Esc / overlay / cancel are locked meanwhile).
 *   // Use this whenever the confirmed action calls a slow edge function so the
 *   // user gets in-flight feedback instead of a silently-closing dialog:
 *   await confirm({ title: t('…'), variant: 'destructive', onConfirm: async () => {
 *     const { error } = await supabase.functions.invoke('deleteTrip', { body });
 *     if (error) { toast(…); return; }  // surface your own error; then it closes
 *     nav('/trips');
 *   }});
 *
 * Resolves true on the action button, false on cancel / ESC / outside click.
 */
const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [opts, setOpts] = useState({});
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const resolverRef = useRef(null);

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      // If a previous prompt is somehow still pending, dismiss it as cancelled.
      if (resolverRef.current) resolverRef.current(false);
      resolverRef.current = resolve;
      setOpts(options);
      setBusy(false);
      setOpen(true);
    });
  }, []);

  const settle = useCallback((result) => {
    if (resolverRef.current) {
      resolverRef.current(result);
      resolverRef.current = null;
    }
  }, []);

  const handleOpenChange = useCallback((next) => {
    if (busy) return; // lock cancel / ESC / outside-click while an async action runs
    setOpen(next);
    if (!next) settle(false); // cancel / ESC / outside click
  }, [settle, busy]);

  const handleConfirm = useCallback(async () => {
    const action = opts.onConfirm;
    if (typeof action === 'function') {
      // Async mode: keep the dialog open with a spinner until the work settles.
      // The action owns its own error reporting; we close regardless afterwards.
      setBusy(true);
      try { await action(); }
      catch { /* caller surfaces its own error toast */ }
      finally { setBusy(false); }
      setOpen(false);
      settle(true);
    } else {
      settle(true);
      setOpen(false);
    }
  }, [opts, settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={opts.title}
        description={opts.description}
        confirmLabel={opts.confirmLabel}
        cancelLabel={opts.cancelLabel}
        variant={opts.variant || 'default'}
        singleButton={opts.singleButton}
        asyncMode={typeof opts.onConfirm === 'function'}
        busy={busy}
        onConfirm={handleConfirm}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>');
  return ctx;
}
