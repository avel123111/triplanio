// @ts-check
import { Drawer } from 'vaul';
import { IconBtn } from '@/design/IconBtn';
import { useT } from '@/lib/i18n/I18nContext';
import { useHostsTextInput } from '@/hooks/useHostsTextInput';

/**
 * C6 · Sheet — canonical mobile bottom-sheet (Lumo `.sheet`).
 *
 * Built on vaul's `Drawer` (which itself wraps Radix Dialog, so we keep the
 * focus-trap, Esc / outside-click and scroll-lock we had before). vaul owns the
 * gesture + animation: the whole surface is draggable with native momentum,
 * velocity-based dismiss, and a spring settle — replacing the old grip-only
 * hand-rolled drag. `repositionInputs` (default) lifts the sheet above the iOS
 * keyboard instead of the page jumping/shrinking, so inputs behave.
 *
 * Used as the mobile shell for menus (ActionMenu) and pickers (SearchSelect)
 * under the mobile breakpoint. On desktop those components render their anchored
 * variants instead.
 *
 *   <Sheet open={open} onOpenChange={setOpen} title="Actions">
 *     ...rows...
 *   </Sheet>
 */
/**
 * ★★ ПОВЕРХНОСТЬ С ТЕКСТОВЫМ ВВОДОМ — ПОЛНОЭКРАННАЯ, И РЕШАЕТ ЭТО ОНА САМА.
 *
 * Правило выведено из замера (iPhone, iOS 26, Safari; раскладка 766, клавиатура
 * 338, полоса 428): Safari ЦЕНТРИРУЕТ фокусное поле в видимой полосе,
 * `сдвиг окна = центрПоля − центрПолосы`. `.sheet` растёт ПО СОДЕРЖИМОМУ от
 * нижней кромки, поэтому короткий шит держит поле внизу экрана — и браузер
 * уводит туда всю страницу, на максимум прокрутки.
 *
 * ★ И ЭТО НЕ ЛЕЧИТСЯ ЯКОРЕМ (`lib/focusAnchor.js`). Якорь приводит поле наверх
 * СКРОЛЛОМ контейнера, а у короткого шита скроллить нечего: `.sheet-b` не
 * переполнен. У прибитой к низу поверхности, растущей по содержимому, рычаг
 * ровно один — её ВЫСОТА. Полноэкранный шит ставит первое поле под шапку, то
 * есть выше центра полосы, где желаемый сдвиг уходит в минус и упирается в верх
 * документа.
 *
 * Кто именно несёт поле — НЕ дело вызывателя (разбор в `useHostsTextInput`):
 * шит смотрит своё поддерево и вешает на себя `data-hosts-input`, CSS читает.
 *
 * ⚠️ Аннотация обязательна не для красоты: без неё TS выводит тип из
 * ДЕСТРУКТУРИЗАЦИИ и делает обязательным КАЖДЫЙ проп без дефолта — законный
 * вызов «шит с видимым заголовком, без `titleText`» краснел на четырёх
 * вызывателях. Та же грабля разобрана в шапке `MobileBottomNav.jsx`.
 *
 * @param {{ open: boolean, onOpenChange: (v: boolean) => void, title?: any, children?: any, className?: string, bodyClassName?: string, titleText?: string }} p
 */
export function Sheet({ open, onOpenChange, title, children, className = '', bodyClassName = '', titleText }) {
  const t = useT();
  const hostRef = useHostsTextInput();
  return (
    // repositionInputs={false}: the app's viewport meta uses
    // `interactive-widget=resizes-content`, so the layout viewport already
    // shrinks above the keyboard and this bottom-anchored sheet (bottom:0 +
    // dvh) sits above it natively. Letting vaul ALSO reposition (its default)
    // double-moves the sheet → the "flying / jumps on focus" bug.
    <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="sheet-backdrop" />
        {/* vaul does NOT auto-focus into the sheet on open, so the mobile keyboard
            stays down until the user taps a field (no jump / iOS zoom on open). */}
        <Drawer.Content ref={hostRef} className={'sheet' + (className ? ' ' + className : '')} aria-describedby={undefined}>
          {/* Visual drag affordance only — the whole sheet is draggable (vaul), so
              this carries no handlers. */}
          <div className="sheet-grip" aria-hidden><i /></div>
          {title ? (
            <div className="sheet-h">
              <Drawer.Title asChild><h3>{title}</h3></Drawer.Title>
              {/* ★TRIP-344: крестик - тот же объект, что в диалоге, и рисуется
                  тем же примитивом. `asChild` нужен, чтобы vaul повесил свои
                  обработчики на САМУ кнопку, а не на лишнюю обёртку. Тон quiet
                  (без tone) — единый крест закрытия, как в канон-диалоге (TRIP-337);
                  ховер приходит от базового `.icon-btn`. */}
              <Drawer.Close asChild>
                <IconBtn icon="close" ariaLabel={t('common.close')} />
              </Drawer.Close>
            </div>
          ) : (
            <Drawer.Title className="sr-only">
              {titleText || t('common.menu')}
            </Drawer.Title>
          )}
          <div className={'sheet-b' + (bodyClassName ? ' ' + bodyClassName : '')}>{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export default Sheet;
