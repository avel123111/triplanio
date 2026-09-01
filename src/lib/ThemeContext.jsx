import React, { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react';
import { seedsLightZone, resolveDark } from '@/lib/documentTheme';

// ⚠️ ТИП БЕРЁТСЯ С ДЕФОЛТНОГО ЗНАЧЕНИЯ, А НЕ С РЕАЛИЗАЦИИ - `createContext`
// выводит форму отсюда. Голая заглушка `setTheme: () => {}` объявляла функцию
// БЕЗ параметров, а провайдер кладёт сюда `setThemeState(value)`, поэтому живой
// `setTheme('light')` давал TS2554 у каждого вызывателя под `// @ts-check`.
// ТРЕТИЙ случай одного корня в этом эпике: до него так же разъехались заглушки
// `t()` (I18nContext) и `startCopy()` (CreateTripProvider) - заглушка и
// реализация расходятся молча, потому что их никто не сверяет.
const ThemeContext = createContext({
  theme: 'light',
  /** @type {(next: string) => void} */
  setTheme: () => {},
  isDark: false,
  toggle: () => {},
  /** @type {(on: boolean) => void} */
  setLightZone: () => {},
});

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    if (typeof window === 'undefined') return 'system';
    // `tp-theme` is canonical; fall back to the legacy `triplanio:theme` key.
    return localStorage.getItem('tp-theme') || localStorage.getItem('triplanio:theme') || 'system';
  });
  const [isDark, setIsDark] = useState(false);

  /* ★ НЕАВТОРИЗОВАННАЯ ЗОНА СВЕТЛАЯ ПО ПОСТРОЕНИЮ — У НЕЁ НЕТ ТЕМЫ.
     Тема по умолчанию `system`, поэтому у человека с тёмной ОС `[data-theme=dark]`
     оказывался на `<html>` и на лендинге, куда он ещё даже не логинился. Своя
     палитра зоны от этого защищена (токены на `html.site`), а вот всё остальное —
     нет: любой компонент ПРИЛОЖЕНИЯ на странице зоны (баннер cookie смонтирован
     вне роутера, чтобы показываться и на анонимных входах) читал тёмные токены и
     вставал тёмным пятном на белом листе. И — хуже — между 112 мс (тема легла) и
     моментом, когда догрузился `site.css`, ТЁМНОЙ была вся страница: замерено
     `rgb(12,14,28)` у `body` на лендинге.

     Лечить это на уровне отдельных элементов бессмысленно: каждый следующий
     компонент приложения, попавший на страницу зоны, принесёт ту же проблему.
     Правило одно и живёт здесь: пока смонтирована оболочка зоны, документ
     светлый. Выбор темы пользователя при этом НЕ трогается — в `tp-theme`
     остаётся то, что он выбрал, и на экранах приложения снова действует. */
  // Затравка — ПО АДРЕСУ, до того как что-либо смонтировалось: оболочка зоны
  // приезжает позже, чем этот эффект кладёт тему (см. `documentTheme.js`).
  // Дальше владельцем становится сама оболочка (`SiteZone` → `useLightZone`),
  // поэтому ошибка затравки стоит одного кадра, а не неверной темы.
  //
  // ★ ВЛАДЕЛЕЦ РОВНО ОДИН, И ЭТО НЕ ПРИДИРКА: удержание — БУЛЕВ ФЛАГ, поэтому
  // два владельца гасят друг друга (снятие одного объявляет зону законченной,
  // пока второй ещё в ней). Понадобится второй — это счётчик удержаний, как у
  // `holdSplash()`, а не второй вызов `useLightZone`.
  const [lightZone, setLightZone] = useState(
    () => (typeof window !== 'undefined' && seedsLightZone(window.location.pathname)),
  );

  useEffect(() => {
    const root = document.documentElement;
    const apply = (t) => {
      const dark = resolveDark({
        stored: t,
        systemDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
        lightZone,
      });
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
  }, [theme, lightZone]);

  const toggle = () => setThemeState(isDark ? 'light' : 'dark');

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeState, isDark, toggle, setLightZone }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

/**
 * Пока компонент смонтирован, документ светлый. Зовёт ОБОЛОЧКА зоны
 * (`SiteZone`) — там же, где живут её `<html lang>`, слой стилей и прокрутка.
 *
 * `useLayoutEffect`, а не `useEffect`: layout-эффекты потомков выполняются ДО
 * пассивного эффекта провайдера в том же коммите, поэтому провайдер применяет
 * тему уже зная про зону — тёмного кадра не существует, а не «он короткий».
 */
export function useLightZone() {
  const { setLightZone } = useContext(ThemeContext);
  useLayoutEffect(() => {
    setLightZone(true);
    return () => setLightZone(false);
  }, [setLightZone]);
}
