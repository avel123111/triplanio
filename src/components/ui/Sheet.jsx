// @ts-check
import { SheetClose, SheetRoot, SheetSurface, SheetTitle } from '@/components/ui/sheetShell';
import { IconBtn } from '@/design/IconBtn';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * C6 · Sheet — canonical mobile bottom-sheet (Lumo `.sheet`).
 *
 * Движение (жест, слайд, клавиатура, портал, подложка, грип) принадлежит шву
 * `ui/sheetShell` — единственному дому vaul; здесь остаётся только СКИН
 * `.sheet` и его состав: грип · шапка с заголовком и крестиком · тело.
 * Раньше этот файл держал свою копию `Drawer.Root → Portal → Overlay →
 * Content`, и таких копий в приложении было четыре.
 *
 * Used as the mobile shell for menus (ActionMenu) and pickers (SearchSelect)
 * under the mobile breakpoint. On desktop those components render their anchored
 * variants instead.
 *
 *   <Sheet open={open} onOpenChange={setOpen} title="Actions">
 *     ...rows...
 *   </Sheet>
 */
/** `onOpenAutoFocus` / `onCloseAutoFocus` уезжают в `Drawer.Content`, то есть в
 *  ШТАТНЫЙ контракт Radix «куда встаёт фокус при открытии и куда возвращается
 *  при закрытии». Это не расширение примитива, а перестало быть его запечатыванием:
 *  vaul по умолчанию ГАСИТ автофокус диалога (`autoFocus = false` -> он зовёт
 *  `preventDefault()` на открытии), и, пока шов не пробрасывал этот хук, поверх
 *  подавления приходилось ставить фокус руками — эффектами, кадрами и синхронными
 *  коммитами. Всё это удалено: у задачи «поле в фокусе при открытии шторки» есть
 *  штатный хук, и теперь он доступен.
 * @param {{ open: boolean, onOpenChange: (v: boolean) => void, title?: any, children?: any, className?: string, bodyClassName?: string, titleText?: string, onOpenAutoFocus?: (e: any) => void, onCloseAutoFocus?: (e: any) => void }} p */
export function Sheet({ open, onOpenChange, title, children, className = '', bodyClassName = '', titleText, onOpenAutoFocus, onCloseAutoFocus }) {
  const t = useT();
  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      <SheetSurface className={'sheet' + (className ? ' ' + className : '')} aria-describedby={undefined} onOpenAutoFocus={onOpenAutoFocus} onCloseAutoFocus={onCloseAutoFocus}>
        {title ? (
          <div className="sheet-h">
            <SheetTitle asChild><h3>{title}</h3></SheetTitle>
            {/* ★TRIP-344: крестик - тот же объект, что в диалоге, и рисуется
                тем же примитивом. `asChild` нужен, чтобы vaul повесил свои
                обработчики на САМУ кнопку, а не на лишнюю обёртку. Тон quiet
                (без tone) — единый крест закрытия, как в канон-диалоге (TRIP-337);
                ховер приходит от базового `.icon-btn`. */}
            <SheetClose asChild>
              <IconBtn icon="close" ariaLabel={t('common.close')} />
            </SheetClose>
          </div>
        ) : (
          <SheetTitle className="sr-only">
            {titleText || t('common.menu')}
          </SheetTitle>
        )}
        <div className={'sheet-b' + (bodyClassName ? ' ' + bodyClassName : '')}>{children}</div>
      </SheetSurface>
    </SheetRoot>
  );
}

export default Sheet;
