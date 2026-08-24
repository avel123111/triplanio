// Подмена фона share-карточки в SVG шаблона (чистые строковые функции; IO —
// в components/trips/shareCard.js).
//
// ★ КОНТРАКТ С EDGE (render-share-card, см. зеркальный комментарий у
// `defaultBgDataUri()` в supabase/functions/render-share-card/render.ts):
// штатный фон — ЕДИНСТВЕННЫЙ jpeg-data-URI во всём SVG (карта — png/плейсхолдер,
// самолётики — png, QR — пути). Поэтому подмена фона = замена этого URI, без
// правки edge-функции: выбранный фон встаёт и в превью (overlay), и в финальный
// PNG (card_svg) против уже задеплоенного шаблона. Что ломает контракт МОЛЧА:
// перегенерация штатного фона в webp/png или второй jpeg-ассет в шаблоне —
// сторож на это: ShareCardDialog кричит в Sentry, когда `cardBgUri` пуст на
// живом overlay. Инварианты закреплены тестом (shareCardBg.test.js).
// ponytail: строковая хирургия — мост до серверного параметра фона; когда
// появится своя коллекция фонов (bg-параметр в render-share-card), подмену
// заменить на параметр запроса.
const BG_URI_RE = /data:image\/jpeg;base64,[^"']*/;

/** Штатный фон карточки из SVG шаблона — data-URI для миниатюры «Стандарт»;
 *  '' = jpeg-фона в шаблоне нет (контракт нарушен, подмена станет no-op). */
export function cardBgUri(svg) {
  return svg?.match(BG_URI_RE)?.[0] || '';
}

/** Вернуть SVG карточки с подменённым фоном; пустой bgDataUri = штатный фон.
 *  Репласер-ФУНКЦИЯ, а не строка: подстановка дословная по построению —
 *  спецпаттерны String.replace (`$&` и т.п.) не интерпретируются. */
export function applyCardBg(svg, bgDataUri) {
  if (!svg || !bgDataUri) return svg;
  return svg.replace(BG_URI_RE, () => bgDataUri);
}
