import { clsx } from "clsx"

// Класс-джойнер. Раньше оборачивал clsx в tailwind-merge для дедупа Tailwind-
// утилит; после ретайра Tailwind (TRIP-53 Этап 4) tailwind-merge не нужен —
// все вызовы передают только наши собственные классы. Оставлен как тонкая
// обёртка над clsx (clsx — не Tailwind), чтобы не трогать файлы-потребители.
export function cn(...inputs) {
  return clsx(inputs)
}


export const isIframe = window.self !== window.top;
