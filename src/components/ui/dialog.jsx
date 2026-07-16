"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { Drawer } from "vaul"
import { cn } from "@/lib/utils"
import { keepFocusInDialog } from "@/lib/dialogFocus"

// Responsive modal: on desktop a centred Radix dialog (unchanged); on phones
// (≤640px) a vaul Drawer bottom-sheet — native full-surface swipe + momentum
// dismiss and `repositionInputs` keyboard handling (replaces the old
// `useSheetSwipe` grip-drag + manual `--kb`/`--vvh`). The breakpoint matches the
// `.dlg-modal` bottom-sheet CSS (≤640) so DOM and styling switch together.
//
// vaul wraps Radix Dialog, so Title / Description / Close / Trigger stay the raw
// Radix primitives below — they work inside either Root. Only the Root and the
// Portal+Overlay+Content need to switch libraries, driven by this context.
const ResponsiveSheetCtx = React.createContext(false)

function useIsSheet() {
  const [isSheet, setIsSheet] = React.useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches,
  )
  React.useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)")
    const onChange = () => setIsSheet(mq.matches)
    mq.addEventListener("change", onChange)
    onChange()
    return () => mq.removeEventListener("change", onChange)
  }, [])
  return isSheet
}

// Root — vaul Drawer on phones, Radix Dialog on desktop. Same open/onOpenChange
// contract either way; the chosen engine is published to <DialogContent>.
const Dialog = ({ children, ...props }) => {
  const isSheet = useIsSheet()
  const Root = isSheet ? Drawer.Root : DialogPrimitive.Root
  return (
    <ResponsiveSheetCtx.Provider value={isSheet}>
      <Root {...props}>{children}</Root>
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
// Phones (≤640px): vaul Drawer.Content — the whole sheet is draggable (native
// swipe-to-dismiss) and vaul lifts it above the keyboard. className + style are
// forwarded to the inner .dlg card so callers can pass .dlg--wide / .dlg--sm.
// No built-in close button — each dialog has its own in the header.
const DialogContent = React.forwardRef(({ className, style, children, ...props }, ref) => {
  const isSheet = React.useContext(ResponsiveSheetCtx)

  if (isSheet) {
    return (
      <Drawer.Portal>
        <Drawer.Overlay className="dlg-backdrop" />
        {/* vaul owns the drag + open/close animation + keyboard reposition. The
            grip is a visual affordance only (the whole surface is draggable). */}
        <Drawer.Content ref={ref} className="dlg-modal" {...props}>
          <div className={cn("dlg", className)} style={style}>
            <div className="dlg-grip" aria-hidden><i /></div>
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    )
  }

  return (
    <DialogPortal>
      <DialogOverlay />
      {/* Focus lands on the dialog CONTENT container (not an input) so it stays
          INSIDE the dialog without popping a field. Shared owner: keepFocusInDialog. */}
      <DialogPrimitive.Content ref={ref} className="dlg-modal" onOpenAutoFocus={keepFocusInDialog} {...props}>
        <div className={cn("dlg", className)} style={style}>
          {/* Drag handle — hidden on desktop via CSS. */}
          <div className="dlg-grip" aria-hidden><i /></div>
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
