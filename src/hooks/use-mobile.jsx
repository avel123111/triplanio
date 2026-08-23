import * as React from "react"

/**
 * ГРАНИЦА РАСКЛАДКИ В ПРИЛОЖЕНИИ ОДНА (TRIP-349).
 *
 * ★ Их было ДВЕ, и это стоило сломанной полосы. `useIsPhone` (640) решал
 * «панель уезжает в шит», `useIsMobile` (768) — «диалог/пикер становится
 * шитом», а CSS планировщика переключал оболочку на 960. Между 641 и 960
 * получалась химера: десктопная панель при телефонной шапке.
 *
 * Планшетной ширины как режима у приложения нет — есть десктоп и телефон, и
 * число у них одно. Второй хук удалён, а не оставлен алиасом: алиас — это
 * приглашение снова развести значения.
 */
export const PHONE_MAX_W = 640

/** Реактивная проверка «телефон» — единственный переключатель раскладки. */
export function useIsPhone() {
  const q = `(max-width: ${PHONE_MAX_W}px)`
  const [phone, setPhone] = React.useState(
    () => typeof window !== "undefined" && window.matchMedia(q).matches,
  )
  React.useEffect(() => {
    const mql = window.matchMedia(q)
    const onChange = () => setPhone(mql.matches)
    mql.addEventListener("change", onChange)
    // Значение могло измениться между синхронным инициализатором и эффектом.
    onChange()
    return () => mql.removeEventListener("change", onChange)
  }, [q])
  return phone
}
