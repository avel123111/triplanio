"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { SheetGrip, SheetRoot, SheetSurface } from "@/components/ui/sheetShell"
import { cn } from "@/lib/utils"
import { keepFocusInDialog } from "@/lib/dialogFocus"
import { useIsPhone } from "@/hooks/use-mobile"

// Responsive modal: on desktop a centred Radix dialog (unchanged); on phones
// (≤640px) the SHARED sheet seam (ui/sheetShell) — native full-surface swipe +
// momentum dismiss and keyboard handling. The breakpoint matches the
// `.dlg-modal` bottom-sheet CSS (≤640) so DOM and styling switch together.
//
// Окно НЕ пишет свою шторку: движение целиком у шва, здесь остаётся скин
// (`.dlg-modal` + карточка `.dlg`). Раньше этот файл держал свою копию
// `Drawer.Root → Portal → Overlay → Content` — одну из четырёх в приложении.
//
// vaul (внутри шва) оборачивает Radix Dialog, поэтому Title / Description /
// Close / Trigger ниже остаются сырыми примитивами Radix — они работают внутри
// любого корня. Переключаются только корень и портал, по этому контексту.
const ResponsiveSheetCtx = React.createContext(false)

// Root — the sheet seam on phones, Radix Dialog on desktop. Same
// open/onOpenChange contract either way; the chosen engine is published to
// DialogContent.
// useIsPhone is the shared ≤640px sheet breakpoint (src/hooks/use-mobile).
const Dialog = ({ children, ...props }) => {
  const isSheet = useIsPhone()
  if (isSheet) {
    return (
      <ResponsiveSheetCtx.Provider value={true}>
        <SheetRoot {...props}>{children}</SheetRoot>
      </ResponsiveSheetCtx.Provider>
    )
  }
  return (
    <ResponsiveSheetCtx.Provider value={false}>
      <DialogPrimitive.Root {...props}>{children}</DialogPrimitive.Root>
    </ResponsiveSheetCtx.Provider>
  )
}

const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

// Overlay — uses design-system .dlg-backdrop (scrim + blur, no Tailwind)
const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn("dlg-backdrop", className)}
    {...props} />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

// Content — .dlg-modal positions the portal. Desktop: centred Radix Content.
// Phones (≤640px): the shared <SheetSurface> — the whole sheet is draggable
// (native swipe-to-dismiss) and the seam lifts it above the keyboard. className + style are
// forwarded to the inner .dlg card so callers can pass .dlg--wide / .dlg--sm.
// No built-in close button — each dialog has its own in the header.
/** ⚠️⚠️ БАЗА АННОТАЦИИ = ТО, КУДА КОМПОНЕНТ РЕАЛЬНО ОТДАЁТ `...props`, А НЕ
 *  «`div` по привычке». Здесь остаток уезжает в `DialogPrimitive.Content`
 *  (и в `Drawer.Content` в режиме шита) - у него есть `onEscapeKeyDown`,
 *  `onPointerDownOutside`, `onOpenAutoFocus`, `onCloseAutoFocus`, которых у
 *  `div` НЕ СУЩЕСТВУЕТ; пересечение с `ComponentPropsWithoutRef<'div'>`
 *  запечатывало их и роняло законный вызов.
 *
 *  ★ Это ЧЕТВЁРТЫЙ виток одной ошибки, и виток ровно потому, что правило
 *  копировалось ФОРМОЙ: `@param {object}` запечатал набор ПРОПОВ → пересечение
 *  с `<'div'>` запечатало НОСИТЕЛЬ у примитивов → то же пересечение запечатало
 *  ЦЕЛЬ ПРОБРОСА здесь. Вопрос, который снимает весь класс: КУДА ЭТОТ КОМПОНЕНТ
 *  ОТДАЁТ ОСТАТОК? У `Layout.jsx` это DOM-тег, поэтому там носитель параметром;
 *  тут это чужой компонент, значит и база берётся у него.
 *
 *  ⚠️ Аннотация стоит НА ПАРАМЕТРЕ, а не перед `const`: функция здесь -
 *  АРГУМЕНТ `forwardRef`, и `@param` над объявлением к ней не относится (первая
 *  редакция так и сделала, ошибки остались - поймано прогоном, не чтением). */
/** ★ `full` ВЫНУТ ИЗ ОСТАТКА ЯВНО, И ЭТО НЕ СТИЛЬ. Остаток пропов уезжает в ДВА
 *  разных места: на телефоне в `SheetSurface` (там роль и нужна), на десктопе в
 *  `DialogPrimitive.Content`, то есть в конечном счёте на DOM-узел — и `full`
 *  сел бы туда неизвестным атрибутом с руганью React. Роль в принципе мобильная:
 *  «экран во весь вьюпорт» — это про телефон, на десктопе окно остаётся окном.
 *
 *  `pinned` СЮДА НЕ ПРОВОДИТСЯ НАМЕРЕННО. Приём «поле стоит, едет заливка»
 *  ключуется на `.ss-list`/`.ss-search` — слотах пикера, которых у окна нет; окно
 *  получило бы ПОЛОВИНУ анимации. Это уже записано в `app.css` про панель
 *  редактора, и здесь тот же вывод: окно въезжает штатным слайдом vaul. */
const DialogContent = React.forwardRef((/** @type {{ className?: string, style?: any, full?: boolean, children?: any } & import('react').ComponentPropsWithoutRef<typeof DialogPrimitive.Content>} */ { className, style, full = false, children, ...props }, ref) => {
  const isSheet = React.useContext(ResponsiveSheetCtx)

  if (isSheet) {
    return (
      <SheetSurface className="dlg-modal" backdropClassName="dlg-backdrop" grip={false} full={full} contentRef={ref} {...props}>
        <div className={cn("dlg", className)} style={style}>
          {/* Грип ВНУТРИ карточки: шторкой становится само окно, и «бровь»
              принадлежит ему, а не порталу. */}
          <SheetGrip />
          {children}
        </div>
      </SheetSurface>
    )
  }

  return (
    <DialogPortal>
      <DialogOverlay />
      {/* Focus lands on the dialog CONTENT container (not an input) so it stays
          INSIDE the dialog without popping a field. Shared owner: keepFocusInDialog. */}
      <DialogPrimitive.Content ref={ref} className="dlg-modal" onOpenAutoFocus={keepFocusInDialog} {...props}>
        {/* Грипа нет: на десктопе это окно, а не шторка. */}
        <div className={cn("dlg", className)} style={style}>
          {children}
        </div>
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

// Header — maps to .dlg__head (flex row with icon + title + optional close)
const DialogHeader = ({ className, ...props }) => (
  <div className={cn("dlg__head", className)} {...props} />
)
DialogHeader.displayName = "DialogHeader"

// Footer — maps to .dlg__foot
const DialogFooter = ({ className, ...props }) => (
  <div className={cn("dlg__foot", className)} {...props} />
)
DialogFooter.displayName = "DialogFooter"

// Title — h2 inside .dlg__head; style comes from .dlg__head h2 CSS
/** База - `DialogPrimitive.Title`, куда уезжает остаток. Закрытый объект из
 *  трёх ключей (первая редакция) был здесь худшим вариантом класса: он не просто
 *  брал не ту базу, а не пересекался НИ С ЧЕМ, и `id` у заголовка краснел. */
const DialogTitle = React.forwardRef((/** @type {import('react').ComponentPropsWithoutRef<typeof DialogPrimitive.Title>} */ { className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("", className)} {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("muted", className)}
    {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
