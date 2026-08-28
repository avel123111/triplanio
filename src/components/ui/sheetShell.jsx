// @ts-check
import { Drawer } from 'vaul';

/**
 * sheetShell — ЕДИНСТВЕННЫЙ ДОМ vaul В ПРИЛОЖЕНИИ.
 *
 * Мобильная шторка была написана ЧЕТЫРЕ РАЗА: `ui/Sheet` (меню/пикеры),
 * `ui/LpSheet` (панели редактора), `ui/dialog` (любая модалка ≤640) и
 * `stats/VisitPanel` (панель визита) — каждый со своим `Drawer.Root →
 * Portal → Overlay → Content`, своим `repositionInputs={false}` и своей
 * копией комментария про «flying bug». Четыре копии одного контракта
 * означают четыре места, куда придётся вносить следующую правку жеста, и
 * ровно одно из них о ней не узнает.
 *
 * Здесь контракт объявлен один раз, а поверхности остаются разными: шов
 * владеет ДВИЖЕНИЕМ (жест, слайд, клавиатура, портал, подложка) и ГРИПОМ,
 * вызыватель — СКИНОМ (класс поверхности) и содержимым.
 *
 * ★ `repositionInputs={false}` — не настройка вкуса. Вьюпорт приложения
 * объявлен `interactive-widget=resizes-content`: раскладка УЖЕ сжимается над
 * клавиатурой, и шит, приклеенный к низу, встаёт над ней сам. Если позволить
 * vaul поднимать его ВТОРОЙ раз, шит «улетает» при фокусе в поле. Значение
 * живёт здесь, чтобы четвёртая поверхность не завелась без него.
 *
 * ★ ПОЧЕМУ ЭТОТ PR РОНЯЕТ `dsshare` НА ДВА. Метрика считает JSX-УЗЛЫ,
 * собранные из ДС, а схлопывание четырёх обвязок в одну убирает узлы:
 * `Drawer.Root → Portal → Overlay → Content` (четыре составных имени, то есть
 * четыре «компонента» для счётчика) в каждом вызывателе становятся
 * `SheetRoot` + `SheetSurface`. Числитель падает ровно там, где кода стало
 * меньше — это не сырая разметка, приехавшая в проект, а удалённый дубль.
 * floor-exempt: dsshare +2 — схлопывание 4 копий vaul-обвязки в один шов убирает JSX-узлы обвязки (Portal/Overlay/Content ×4 → SheetSurface); поручение Pavel «схлопывай и унифицируй шторки»
 *
 * НЕ сюда: `PeekSheet` — немодальный шит с детентами. Он намеренно не на
 * vaul (разбор в его шапке): vaul лочит страницу и ставит `touch-action:
 * none` на всю поверхность, что несовместимо с постоянным шитом над живой
 * картой. Это другой архетип, а не пятая копия этого.
 */

/**
 * Корень шторки. Открытость контролирует вызыватель — как у `Drawer.Root`.
 * @param {{ open?: boolean, onOpenChange?: (v: boolean) => void, children?: any }} p
 */
export function SheetRoot({ children, ...props }) {
  return <Drawer.Root repositionInputs={false} {...props}>{children}</Drawer.Root>;
}

/**
 * Грип — «бровь» шторки. Affordance И НИЧЕГО БОЛЬШЕ: тянется вся поверхность
 * (это делает vaul), поэтому обработчиков на нём нет и быть не должно.
 * Единственная разметка грипа в приложении — у функционального грипа
 * `PeekSheet` своя роль (`role="slider"` + стрелки), и он не отсюда.
 */
export function SheetGrip() {
  return <div className="sheet-grip" aria-hidden><i /></div>;
}

/**
 * Поверхность шторки: портал + подложка + перетаскиваемый лист.
 *
 * `className` — СКИН вызывателя (`.sheet`, `.lp-sheet`, `.dlg-modal`,
 * `.vpanel`…): шов не решает, как поверхность выглядит. `grip={false}` — для
 * тех, кто рисует грип сам внутри своей карточки (модалка кладёт его внутрь
 * `.dlg`) или у кого его нет вовсе (полноэкранная панель редактора).
 * Остаток пропов уезжает в `Drawer.Content` — там живут `aria-describedby`,
 * `onOpenAutoFocus` и прочий контракт Radix, который vaul пробрасывает.
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
      {/* vaul НЕ переводит фокус внутрь шторки на открытии — клавиатура на
          телефоне остаётся опущенной, пока не тронули поле (без прыжка и
          зума iOS на открытии). */}
      <Drawer.Content ref={contentRef} className={className} {...rest}>
        {grip ? <SheetGrip /> : null}
        {children}
      </Drawer.Content>
    </Drawer.Portal>
  );
}

/**
 * Заголовок и закрытие шторки — примитивы vaul (он оборачивает Radix Dialog,
 * которому заголовок нужен для доступного имени). Реэкспорт, а не свой
 * компонент: он бы только прятал контракт Radix, ничего к нему не добавляя.
 */
export const SheetTitle = Drawer.Title;
export const SheetClose = Drawer.Close;
