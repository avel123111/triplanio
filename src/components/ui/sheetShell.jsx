// @ts-check
import { Drawer } from 'vaul';

/**
 * sheetShell — ЕДИНСТВЕННЫЙ ДОМ vaul В ПРИЛОЖЕНИИ.
 *
 * Мобильная шторка была написана четыре раза (`ui/Sheet`, `ui/LpSheet`,
 * `ui/dialog` ≤640, `stats/VisitPanel` ≤640) — четыре копии одной обвязки,
 * то есть четыре места под следующую правку жеста, и одно из них о ней не
 * узнает. Здесь контракт объявлен один раз: шов владеет ДВИЖЕНИЕМ (жест,
 * слайд, портал, подложка, клавиатура, грип), вызыватель — СКИНОМ.
 *
 * ★ `repositionInputs={false}` — не вкус. Вьюпорт объявлен
 * `interactive-widget=resizes-content`: раскладка уже сжимается над
 * клавиатурой, и приклеенный к низу шит встаёт над ней сам. Позволить vaul
 * поднять его ВТОРОЙ раз — это «улетающий» шит при фокусе в поле.
 *
 * НЕ сюда: `PeekSheet` — немодальный шит с детентами, намеренно не на vaul
 * (vaul лочит страницу и ставит `touch-action: none` на всю поверхность, что
 * несовместимо с постоянным шитом над живой картой; разбор в его шапке).
 */

/**
 * Корень шторки. Открытость контролирует вызыватель — как у `Drawer.Root`.
 * @param {{ open?: boolean, onOpenChange?: (v: boolean) => void, children?: any }} p
 */
export function SheetRoot({ children, ...props }) {
  return <Drawer.Root repositionInputs={false} {...props}>{children}</Drawer.Root>;
}

/**
 * Грип — «бровь» шторки: affordance и ничего больше (тянется вся поверхность,
 * это делает vaul), поэтому обработчиков на нём нет. Единственная разметка
 * грипа в приложении; функциональный грип `PeekSheet` — не отсюда.
 */
export function SheetGrip() {
  return <div className="sheet-grip" aria-hidden><i /></div>;
}

/**
 * Поверхность шторки: портал + подложка + перетаскиваемый лист.
 *
 * `className` — СКИН вызывателя (`.sheet`, `.lp-sheet`, `.dlg-modal`): шов не
 * решает, как поверхность выглядит. `grip={false}` — тем, кто рисует грип сам
 * внутри своей карточки (модалка кладёт его в `.dlg`) или у кого его нет
 * (полноэкранная панель редактора). Остаток пропов уезжает в `Drawer.Content`
 * — там `aria-describedby`, `onOpenAutoFocus` и прочий контракт Radix.
 *
 * @param {{ className: string, backdropClassName?: string, grip?: boolean,
 *   contentRef?: any, children?: any }} p
 */
export function SheetSurface({
  className,
  backdropClassName = 'sheet-backdrop',
  grip = true,
  contentRef,
  children,
  ...rest
}) {
  return (
    <Drawer.Portal>
      <Drawer.Overlay className={backdropClassName} />
      {/* vaul не переводит фокус внутрь на открытии — клавиатура остаётся
          опущенной, пока не тронули поле (без прыжка и зума iOS). */}
      <Drawer.Content ref={contentRef} className={className} {...rest}>
        {grip ? <SheetGrip /> : null}
        {children}
      </Drawer.Content>
    </Drawer.Portal>
  );
}

/** Заголовок и закрытие — примитивы vaul как есть: своя обёртка только прятала
 *  бы контракт Radix (доступное имя), ничего к нему не добавляя. */
export const SheetTitle = Drawer.Title;
export const SheetClose = Drawer.Close;
