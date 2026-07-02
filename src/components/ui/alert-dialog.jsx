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
    style={{ zIndex: 300 }}
    {...props}
    ref={ref} />
))
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

// Content — .dlg-modal + .dlg .dlg--sm card. className forwarded to inner card.
// z-index 301 ensures ConfirmDialog always renders above any Dialog (z-index 201).
const AlertDialogContent = React.forwardRef(({ className, children, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className="dlg-modal"
      style={{ zIndex: 301 }}
      {...props}>
      <div className={cn("dlg dlg--sm", className)}>
        {children}
      </div>
    </AlertDialogPrimitive.Content>
  </AlertDialogPortal>
))
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

// Header — .dlg__body (title + description inside)
const AlertDialogHeader = ({ className, ...props }) => (
  <div className={cn("dlg__body", className)} {...props} />
)
AlertDialogHeader.displayName = "AlertDialogHeader"

// Footer — .dlg__foot
const AlertDialogFooter = ({ className, ...props }) => (
  <div className={cn("dlg__foot", className)} {...props} />
)
AlertDialogFooter.displayName = "AlertDialogFooter"

// Title — renders as h2; styled by .dlg__body or .dlg--confirm h2
const AlertDialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn("", className)}
    {...props} />
))
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const AlertDialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("muted t-body", className)}
    style={{ marginTop: 6 }}
    {...props} />
))
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName

// Cancel — design-system ghost button
const AlertDialogCancel = React.forwardRef(({ className, children, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn("btn btn--ghost", className)}
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
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
