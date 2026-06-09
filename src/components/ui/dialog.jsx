"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root
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

// Content — .dlg-modal positions the portal (desktop: centred, mobile ≤640px: bottom sheet via CSS).
// className + style are forwarded to the inner .dlg card so callers can pass .dlg--wide / .dlg--sm.
// No built-in close button — each dialog has its own in the header.
const DialogContent = React.forwardRef(({ className, style, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    {/* Don't pull focus into the dialog on open — on mobile that pops the keyboard
        and makes the bottom-sheet jump/zoom. Focus on user tap instead. Callers can
        override by passing their own onOpenAutoFocus. */}
    <DialogPrimitive.Content ref={ref} className="dlg-modal" onOpenAutoFocus={(e) => e.preventDefault()} {...props}>
      <div className={cn("dlg", className)} style={style}>
        {children}
      </div>
    </DialogPrimitive.Content>
  </DialogPortal>
))
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
const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
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
