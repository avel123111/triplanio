// @ts-check
import { createContext, useContext } from 'react';
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
 * ГЛУБИНА ВЛОЖЕННОСТИ ШТОРОК. Шторка над шторкой — не экзотика, а норма: окно
 * события и окно «добавить место» САМИ являются шторками на телефоне, и пикер
 * города, открытый из них, обязан лечь ПОВЕРХ. У vaul для этого отдельный корень
 * (`Drawer.NestedRoot`), и выбирать между ним и обычным нужно ПО ФАКТУ ДЕРЕВА, а
 * не пропом вызывателя: проп означал бы, что каждый пикер обязан знать, кто его
 * открыл, и соврал бы ровно в тот день, когда экран переставили.
 *
 * ⚠️ ОШИБКА ЗДЕСЬ НЕ ПАДАЕТ, А ТИХО МЕНЯЕТ ПОВЕДЕНИЕ — и это единственная причина,
 * по которой выбор стоит того, чтобы быть автоматическим. Проверено на месте:
 * `NestedRoot` вне родителя НЕ бросает, хотя и содержит `throw`, — у vaul в
 * дефолтном значении контекста `onNestedDrag` объявлен заглушкой, и условие
 * никогда не выполняется. Значит цена промаха такая:
 *   • `NestedRoot` на глубине 0 → в `Root` уезжает `nested: true`, а закрытие и
 *     перетаскивание привязаны к заглушкам родителя, которого нет;
 *   • обычный `Root` на глубине >0 → родитель не узнаёт об открытии ребёнка и
 *     продолжает считать себя верхней поверхностью.
 * Ни то, ни другое не даёт ни исключения, ни красного теста.
 *
 * Контекст течёт СКВОЗЬ портал (React), поэтому вложенная шторка видит родителя,
 * хотя физически живёт в `document.body`. Глубина растёт только внутри
 * отрисованного содержимого: закрытая шторка портал не монтирует, и её потомков
 * в дереве нет.
 */
const SheetDepth = createContext(0);

/**
 * Корень шторки. Открытость контролирует вызыватель — как у `Drawer.Root`.
 * @param {{ open?: boolean, onOpenChange?: (v: boolean) => void, children?: any }} p
 */
export function SheetRoot({ children, ...props }) {
  const depth = useContext(SheetDepth);
  const Root = depth > 0 ? Drawer.NestedRoot : Drawer.Root;
  return (
    <SheetDepth.Provider value={depth + 1}>
      <Root repositionInputs={false} {...props}>{children}</Root>
    </SheetDepth.Provider>
  );
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
