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
/** Проброса `onOpenAutoFocus`/`onCloseAutoFocus` здесь НЕТ намеренно. Он был
 *  заведён под пикер, который ставил фокус в поле поиска, и вместе с той затеей
 *  и ушёл: на тач-платформе программный фокус даёт каретку без клавиатуры
 *  (разбор — в шапке `ui/PickerSheet`). Умолчание vaul — не переводить фокус
 *  внутрь — оказалось верным поведением, и переопределять его некому.
 *  Понадобится снова — контракт Radix никуда не делся: остаток пропов
 *  `SheetSurface` уезжает прямо в `Drawer.Content`.
 *  `contentRef` — ссылка НА САМУ поверхность (`Drawer.Content`). Нужна тем, у
 *  кого есть правило вида «моё ли это поддерево»: клавиатуру держит
 *  сфокусированное поле, и снять фокус на закрытии может только тот, кто умеет
 *  отличить своё поле от чужого (`contains`). `SheetSurface` этот проп уже
 *  принимает — здесь он просто не был проброшен.
 *  `full` — РОЛЬ, а не скин: «эта поверхность — экран во весь вьюпорт». Признак
 *  ставит шов (`ui/sheetShell`), CSS адресует признак; здесь проп только
 *  проезжает насквозь, чтобы у роли был один способ заявиться (TRIP-494).
 * @param {{ open: boolean, onOpenChange: (v: boolean) => void, title?: any, children?: any, className?: string, bodyClassName?: string, titleText?: string, full?: boolean, contentRef?: any }} p */
export function Sheet({ open, onOpenChange, title, children, className = '', bodyClassName = '', titleText, full = false, contentRef }) {
  const t = useT();
  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      <SheetSurface className={'sheet' + (className ? ' ' + className : '')} full={full} contentRef={contentRef} aria-describedby={undefined}>
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
