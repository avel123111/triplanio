// @ts-check
import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

// Base visuals live in `.pop` (design/app.css, Lumo tokens). Callers pass their
// own class for size/padding overrides (.bell-dd-pop, .pop-flush, …).
// ⚠️ База аннотации — ЦЕЛЬ ПРОБРОСА, а не `div`: остаток пропов уезжает в
// `PopoverPrimitive.Content`, у которого есть свои `onEscapeKeyDown`,
// `collisionPadding` и прочее, чего у `div` нет. Без аннотации TS выводит тип
// из деструктуризации и запечатывает набор до `RefAttributes` — тогда у
// вызывающего под `// @ts-check` краснеет даже `children` (TRIP-388, тот же
// дефект чинили у `DialogContent`).
const PopoverContent = React.forwardRef(
  /** @param {React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>} p */
  ({ className, align = "center", sideOffset = 4, style, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      // Floating dropdowns must sit ABOVE dialogs (--z-popover is above the
      // --z-modal floor .dlg-modal uses) so the address/currency lists aren't
      // clipped behind an open modal.
      style={{ zIndex: 'var(--z-popover)', ...style }}
      className={["pop", className].filter(Boolean).join(" ")}
      {...props} />
  </PopoverPrimitive.Portal>
  ),
)
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
