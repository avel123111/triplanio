import { SheetRoot, SheetSurface, SheetTitle } from '@/components/ui/sheetShell';

/**
 * LpSheet — the shared mobile shell for the in-place editor panels (the `.lp-sheet`
 * skin): a bare, full-height sheet that hosts a panel which brings its OWN
 * header / Back button (CityPanel, EventSourcePanel, AddBookingPanel, …).
 *
 * Single-sourced here so the two callers can't drift: on phones (≤640) BOTH the
 * structure editor (TripStructureEdit) and the global EventDrawerHost render their
 * mobile panel through this. Previously each hand-rolled the identical
 * Drawer.Root→Portal→Overlay→Content markup.
 *
 * Движение принадлежит шву `ui/sheetShell` (единственный дом vaul): слайд,
 * свайп-вниз-на-закрытие и подъём над клавиатурой.
 *
 * ★ ЭТО ТА ЖЕ ПОВЕРХНОСТЬ, ЧТО ШТОРКА ПИКЕРА, И ЗАЯВЛЯЕТСЯ ОНА ТАК ЖЕ (TRIP-494).
 * Полноростных поверхностей в приложении две, и роль у них одна — экран во весь
 * вьюпорт; отсюда `full`: коробку, краску и резерв под клавиатуру обе берут из
 * ОДНОГО правила семьи, а не каждая из своего.
 *
 * ⚠️ БРОВЬ ЗДЕСЬ БЫЛА СНЯТА, И ОБОСНОВАНИЕ ОКАЗАЛОСЬ ЛОЖНЫМ. Стояло: «бровь
 * обещала бы шторку по содержимому». Соседка опровергает: шторка пикера ровно
 * так же полноростная и бровь носит, а эта поверхность закрывается СВАЙПОМ
 * (`dismissible` у vaul по умолчанию, никто его не снимал) — то есть бровь
 * описывает существующий жест, а не обещает несуществующий рост. Кнопка
 * «Назад» самой панели, свайп и тап по фону — по-прежнему три двери закрытия;
 * бровь — четвёртая подсказка, общая с остальными шторками приложения
 * (единственная разметка грипа — `SheetGrip`, решение Pavel 31.08.2026).
 *
 * ⚠️ ЭТА ПОВЕРХНОСТЬ — ДЛЯ ЛИНЗ БЕЗ КАРТЫ (таймлайн, календарь, бюджет, обзор):
 * за ней контент, поэтому она модальна и занимает экран. На экране с картой
 * панель живёт СЛОЕМ ВНУТРИ ШИТА СЦЕНЫ (`design/MapShell`) и сюда не приходит:
 * там она обязана вставать ростом шита, подниматься его жестом и не гасить
 * карту, а всё это — свойства шита, а не второй поверхности поверх него.
 *
 * The breakpoint (sheet vs each host's own desktop layout) stays in the caller —
 * this is only the mobile shell.
 */
export default function LpSheet({ open, onClose, title = '', children }) {
  return (
    <SheetRoot open={open} onOpenChange={(o) => { if (!o) onClose?.(); }}>
      {/* vaul wraps Radix Dialog, which requires a Title for a11y — kept sr-only
          since the hosted panel renders its own visible heading. */}
      <SheetSurface className="lp-sheet" full aria-describedby={undefined}>
        <SheetTitle className="sr-only">{title}</SheetTitle>
        {children}
      </SheetSurface>
    </SheetRoot>
  );
}
