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

/**
 * ВТОРАЯ КОЛОНКА — ДРУГОЙ ВОПРОС, А НЕ ВТОРАЯ ГРАНИЦА РАСКЛАДКИ (TRIP-535).
 *
 * `PHONE_MAX_W` отвечает «панель уезжает в шит»; здесь спрашивают другое —
 * «помещается ли РЯДОМ с панелью вторая колонка так, чтобы карте осталась
 * работающая площадь». Панель `clamp(540px, 46vw, 620px)` плюс колонка 340
 * оставляют карте на 1280 около 350 px — это и есть нижняя граница, при которой
 * карта ещё карта, а не полоска.
 *
 * ★ ВЕЛИЧИНА ЖИВЁТ ТОЛЬКО ЗДЕСЬ. У неё нет CSS-двойника: медиазапроса на
 * `--mapshell-aside-w` в таблице стилей нет, колонку просто НЕ РИСУЮТ. Иначе
 * повторился бы разлом TRIP-349 — два числа на один вопрос и химера между ними.
 */
export const TWO_COL_MIN_W = 1280

/** Помещается ли вторая колонка рядом с панелью (десктоп достаточной ширины). */
export function useTwoColumns() {
  const q = `(min-width: ${TWO_COL_MIN_W}px)`
  const [wide, setWide] = React.useState(
    () => typeof window !== "undefined" && window.matchMedia(q).matches,
  )
  React.useEffect(() => {
    const mql = window.matchMedia(q)
    const onChange = () => setWide(mql.matches)
    mql.addEventListener("change", onChange)
    onChange()
    return () => mql.removeEventListener("change", onChange)
  }, [q])
  return wide
}
