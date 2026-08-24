// Подложка share-карточки в SVG-шаблоне (чистые строковые функции; IO — в
// components/trips/shareCard.js). TRIP-443: новый дизайн — прозрачный стикер,
// фон приходит ОТДЕЛЬНЫМ слоем-плейсхолдером, а не запечён в шаблон.
//
// ★ КОНТРАКТ С EDGE (render-share-card/template.ts, BG_TOKEN): шаблон рисует
// full-bleed `<image href="__SHARE_CARD_BG__">` в самом низу. Клиент:
//   · выбран фон  → подменяет токен на data-URI выбранной подложки;
//   · «Стандарт»  → удаляет элемент целиком → карточка прозрачная.
// И в превью (overlay), и в финале (card_svg) — один токен. Инварианты закреплены
// тестом (shareCardBg.test.js).
const BG_TOKEN = '__SHARE_CARD_BG__';
// Элемент фона целиком (для удаления, когда подложки нет). Токен — единственный
// маркер; `[^>]*` с обеих сторон снимает весь самозакрывающийся <image .../>.
const BG_IMG_RE = new RegExp(`<image[^>]*${BG_TOKEN}[^>]*/>`);

/** SVG карточки с подложкой: непустой bgDataUri встаёт фоном, пустой — фон
 *  удаляется (прозрачно). Реплейсер-ФУНКЦИЯ: подстановка дословная (спецпаттерны
 *  String.replace вроде `$&` не интерпретируются). */
export function applyCardBg(svg, bgDataUri) {
  if (!svg) return svg;
  if (!bgDataUri) return svg.replace(BG_IMG_RE, '');
  return svg.replace(BG_TOKEN, () => bgDataUri);
}
