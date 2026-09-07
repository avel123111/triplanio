import React from 'react';
import { ILLUSTRATIONS } from './illustrations';

// ─── Illustration (TRIP-532) ─────────────────────────────────────────────────
// Картинка-иллюстрация из реестра `illustrations.js`: `<Illustration name="create-ai" />`.
//
// У примитива НАМЕРЕННО нет своего класса. Размер, рамку, подложку и отступ
// задаёт владелец — так же, как иконке: `.choice-card__vis img`, `.eroute__fig img`.
// Иначе у картинки появился бы второй голос в раскладке каждого места, где она
// стоит, и каждый вызыватель переопределял бы его инлайном (класс TRIP-282).
// Отсюда же — ни одного нового namespace ради иллюстраций (правило #6).
//
// Декор по умолчанию (`alt=""`): картинка дублирует подпись рядом, скринридеру
// её читать не нужно. Осмысленный `alt` передаёт вызыватель, когда картинка
// несёт то, чего нет в тексте.
//
// Неизвестное имя = ошибка автора, а не состояние UI: рендерим ничего, а
// литералы `name="…"` по всему `src/` сверяет с реестром `illustrations.test.js`.
/** @param {{ name: string, alt?: string, className?: string }} p */
export const Illustration = ({ name, alt = '', className }) => {
  const pic = ILLUSTRATIONS[name];
  if (!pic) return null;
  return (
    <img
      src={pic.src} width={pic.w} height={pic.h} alt={alt}
      loading="lazy" decoding="async" className={className}
    />
  );
};
