import * as React from "react"

const MOBILE_BREAKPOINT = 768

function getIsMobile() {
  if (typeof window === "undefined") return false
  return window.innerWidth < MOBILE_BREAKPOINT
}

export function useIsMobile() {
  // Initialise synchronously so the FIRST render already has the correct value.
  // A lazy `undefined` (corrected only in an effect after paint) made consumers
  // that mount when opened — e.g. dialogs rendering autoFocus={!isMobile} — see
  // isMobile=false on first render and pop the mobile keyboard before the effect
  // ran. Components mounted persistently never hit this, which is why the bug
  // showed only in freshly-mounted dialogs (DocsLens / BudgetLens).
  const [isMobile, setIsMobile] = React.useState(getIsMobile)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    mql.addEventListener("change", onChange)
    onChange()
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
