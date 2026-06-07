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
 * Resolves true on the action button, false on cancel / ESC / outside click.
 */
const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [opts, setOpts] = useState({});
  const [open, setOpen] = useState(false);
  const resolverRef = useRef(null);

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      // If a previous prompt is somehow still pending, dismiss it as cancelled.
      if (resolverRef.current) resolverRef.current(false);
      resolverRef.current = resolve;
      setOpts(options);
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
    setOpen(next);
    if (!next) settle(false); // cancel / ESC / outside click
  }, [settle]);

  const handleConfirm = useCallback(() => {
    settle(true);
    setOpen(false);
  }, [settle]);

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
