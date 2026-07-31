import React, { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext({ theme: 'light', setTheme: () => {}, isDark: false, toggle: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    if (typeof window === 'undefined') return 'system';
    // `tp-theme` is canonical; fall back to the legacy `triplanio:theme` key.
    return localStorage.getItem('tp-theme') || localStorage.getItem('triplanio:theme') || 'system';
  });
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const apply = (t) => {
      const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      // [data-theme] is the ONLY theming switch — nothing reads a `.dark`
      // class any more, so don't reintroduce one alongside it (TRIP-321).
      root.setAttribute('data-theme', dark ? 'dark' : 'light');
      setIsDark(dark);
    };
    apply(theme);
    try { localStorage.setItem('tp-theme', theme); } catch { /* ignore */ }

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => { if (theme === 'system') apply('system'); };
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, [theme]);

  const toggle = () => setThemeState(isDark ? 'light' : 'dark');

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeState, isDark, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
