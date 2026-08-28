import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"
import { cn } from "@/lib/utils"

const AlertDialog = AlertDialogPrimitive.Root
const AlertDialogTrigger = AlertDialogPrimitive.Trigger
const AlertDialogPortal = AlertDialogPrimitive.Portal

// Overlay — design-system .dlg-backdrop
const AlertDialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn("dlg-backdrop", className)}
    style={{ zIndex: 'var(--z-confirm)' }}
    {...props}
    ref={ref} />
))
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

// Content — .dlg-modal + .dlg .dlg--sm card. className forwarded to inner card.
// The --z-confirm floor keeps ConfirmDialog above any Dialog (--z-modal).
const AlertDialogContent = React.forwardRef(({ className, children, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className="dlg-modal"
      style={{ zIndex: 'calc(var(--z-confirm) + 1)' }}
      {...props}>
      <div className={cn("dlg dlg--sm", className)}>
        {children}
      </div>
    </AlertDialogPrimitive.Content>
  </AlertDialogPortal>
))
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

// ★ `AlertDialogHeader` УДАЛЁН. Он рисовал `.dlg__body` — то есть у окна
// подтверждения ТЕЛО работало ШАПКОЙ: заголовок лежал в теле, а `.dlg__head` не
// было вовсе. Пока у тела был крупный паддинг (20), это не бросалось в глаза;
// после перевода тела на 6 заголовок оказался бы в 6 px от края карточки. Плюс
// заголовок был голым `<h2>` и брал канон от ТЕГА, поэтому мимо него проходила
// любая правка `.dlg__head h2` — confirm молча оставался на прежней типографике.
// Теперь ConfirmDialog собирает ту же анатомию, что и все окна: `.dlg__head` с
// заголовком + `.dlg__body` с описанием. Сам компонент-обёртка не нужен — его
// телом был один className, а вызыватель ровно один.

// Footer — .dlg__foot
const AlertDialogFooter = ({ className, ...props }) => (
  <div className={cn("dlg__foot", className)} {...props} />
)
AlertDialogFooter.displayName = "AlertDialogFooter"

// Title — renders as h2; внутри `.dlg__head` его типографику держит канон
// `.dlg__head h2` (Subheading), общий со всеми остальными окнами.
const AlertDialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn("", className)}
    {...props} />
))
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

// Description — тон `muted`, а кегль приходит от тела окна (канон `.dlg__body`
// = Support). Свой `t-body` снят: он перебивал канон обратно на 15 и делал из
// окна лоскут. Инлайновый `marginTop: 6` тоже снят — отступ до заголовка держит
// хром (12 у шапки + 6 у тела), а не соседний узел.
const AlertDialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("muted", className)}
    {...props} />
))
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName

// Cancel — вторая кнопка диалога, тон `secondary` (TRIP-344 PR 3: тон `ghost`
// удалён из системы). Класс написан строкой, а не через <Btn>: носителем обязан
// остаться `AlertDialogPrimitive.Cancel` — на нём висит закрытие диалога.
const AlertDialogCancel = React.forwardRef(({ className, children, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn("btn btn--secondary", className)}
    {...props}>
    {children}
  </AlertDialogPrimitive.Cancel>
))
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

// Action — design-system primary button; pass variant="destructive" for danger
const AlertDialogAction = React.forwardRef(({ className, variant, children, ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={cn(
      variant === 'destructive' ? "btn btn--danger-solid" : "btn btn--primary",
      className
    )}
    {...props}>
    {children}
  </AlertDialogPrimitive.Action>
))
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
