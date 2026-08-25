import React, { useEffect, useRef } from 'react';
import LpSheet from '@/components/ui/LpSheet';
import { useIsPhone } from '@/hooks/use-mobile';
import { usePresence } from '@/hooks/usePresence';

/**
 * Global host for the event / city side panels — the same "drawer" panels the
 * structure editor uses (EventSourcePanel / CityPanel / EventEditDialog panel),
 * now presentable OUTSIDE the editor (timeline / calendar / budget / overview)
 * so those screens drop the legacy EventModal (TRIP-195).
 *
 * Placement:
 *  - ≤640px: the shared Radix bottom-sheet (`.lp-sheet` / `.sheet-backdrop`),
 *    identical to the editor's mobile panel.
 *  - >640px: the SAME floating widget the route editor uses — a `.ts-pdrawer`
 *    card inside a positioning box (`.evd-drawer`) that mirrors the editor's
 *    `.mapshell__overlay` geometry (inset `--sp-7`, width `--mapshell-panel-w`).
 *    Mount it inside a `position: relative` container that already sits below the
 *    header and right of the menu (e.g. `.trip-content`) so the widget never
 *    covers the header or the menu — only the content area.
 *
 * `scrim` is the variable screen shading (TRIP-195): timeline/calendar/budget
 * pass `scrim` so the rest of the content dims behind the widget. Clicking the
 * scrim does NOT close the widget (product decision) — close via the panel's own
 * Back/Done or Esc.
 */
export default function EventDrawerHost({ open, onClose, scrim = false, title = '', children }) {
  const drawerRef = useRef(null);

  // ≤640 → bottom sheet, matching the `.lp-sheet` CSS breakpoint (the shared
  // единственный переключатель раскладки — граница у приложения одна).
  const isSheet = useIsPhone();

  // ВЫХОДНАЯ анимация: держим ящик смонтированным, пока играет закрытие
  // (`usePresence`). Содержимое на время выхода замораживаем — при закрытии
  // родитель гасит своё состояние, и `children` стал бы null на середине
  // анимации (пустой ящик уезжал бы вместо панели).
  const { present, closing } = usePresence(open, 240);
  const lastChildren = useRef(children);
  if (open) lastChildren.current = children;
  const content = open ? children : lastChildren.current;

  // Desktop drawer: move focus into the panel on open, Esc closes.
  // `present` В ЗАВИСИМОСТЯХ обязателен: узел монтируется на кадр ПОЗЖЕ, чем
  // `open` стал true (present догоняет эффектом usePresence), и без него фокус
  // приходил бы на ещё не смонтированный ref и терялся при переоткрытии.
  useEffect(() => {
    if (!open || isSheet || !present) return;
    drawerRef.current?.focus();
  }, [open, present, isSheet]);

  // ≤640 → the shared mobile panel shell (same vaul Drawer as the editor).
  // vaul сам анимирует и вход, и ВЫХОД по `open` (своим темпом, длиннее нашего
  // `ms`), поэтому НЕ размонтируем его по `!open` и не режем `usePresence`-ом:
  // хост живёт в дереве постоянно (слот `drawer` оболочки), отдаём `open`
  // внутрь — vaul доигрывает уход и сам убирает содержимое. Контент на время
  // ухода заморожен (`content`), иначе шит уезжал бы пустым.
  if (isSheet) {
    return <LpSheet open={open} onClose={onClose} title={title}>{content}</LpSheet>;
  }

  if (!present) return null;

  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };

  return (
    <>
      {scrim && <div className="evd-scrim" data-closing={closing || undefined} aria-hidden />}
      {/* Один узел несёт и геометрию коробки (`.evd-drawer` — инсет + ширина
          виджета), и облик самого виджета (`.ts-pdrawer` — грунт/радиус/тень/
          анимация, ТОТ ЖЕ класс, что в редакторе маршрута, без второй копии
          скина; reuse, rule #6). `.lp` остаётся прямым потомком, поэтому ресет
          `.ts-pdrawer > .lp` действует. `data-closing` переключает анимацию на
          выходную. */}
      <div ref={drawerRef} tabIndex={-1} onKeyDown={onKey} className="evd-drawer ts-pdrawer" data-closing={closing || undefined}>
        {content}
      </div>
    </>
  );
}
