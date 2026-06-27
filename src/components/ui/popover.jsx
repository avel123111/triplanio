import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

// Base visuals live in `.pop` (design/app.css, Lumo tokens). Callers pass their
// own class for size/padding overrides (.bell-dd-pop, .pop-flush, …).
const PopoverContent = React.forwardRef(({ className, align = "center", sideOffset = 4, style, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      // Floating dropdowns must sit ABOVE dialogs (.dlg-modal z-index 201) so the
      // address/currency lists aren't clipped behind an open modal.
      style={{ zIndex: 250, ...style }}
      className={["pop", className].filter(Boolean).join(" ")}
      {...props} />
  </PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
