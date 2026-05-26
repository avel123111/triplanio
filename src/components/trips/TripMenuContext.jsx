import React, { createContext, useContext, useState, useCallback } from 'react';

/**
 * Context for opening the mobile trip side-menu (Sheet) from the AppHeader
 * burger button. Provider is mounted by <TripShell/>; the AppHeader subscribes
 * to it only on trip routes via useOptionalTripMenu().
 */
const TripMenuContext = createContext(null);

export function TripMenuProvider({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const open = useCallback(() => setMobileOpen(true), []);
  const close = useCallback(() => setMobileOpen(false), []);
  const value = { mobileOpen, setMobileOpen, open, close };
  return <TripMenuContext.Provider value={value}>{children}</TripMenuContext.Provider>;
}

// Throws-if-missing variant — used inside TripShell-children.
export function useTripMenu() {
  const ctx = useContext(TripMenuContext);
  if (!ctx) throw new Error('useTripMenu must be used inside <TripMenuProvider>');
  return ctx;
}

// Safe variant — returns null outside the provider. Used by AppHeader so it
// can render a burger only on trip routes without crashing on other pages.
export function useOptionalTripMenu() {
  return useContext(TripMenuContext);
}