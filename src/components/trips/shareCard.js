import { invokeFn } from '@/lib/invokeFn';
import { blobToDataUri } from '@/lib/map/captureMap';

// Must match MAP_PLACEHOLDER in the render-share-card edge function (card_svg mode).
export const MAP_PLACEHOLDER = '__SHARE_CARD_MAP__';

// A short retry to ride out a transient invoke failure (network / cold isolate).
// overlay and card_svg both return an SVG string; we retry only transient failures
// - a definitive app code (no_transit_cities) or a success returns immediately.
export async function invokeCard(body, tries = 3) {
  let last;
  for (let attempt = 0; attempt < tries; attempt++) {
    // eslint-disable-next-line no-await-in-loop
    last = await invokeFn('render-share-card', { body });
    // render-share-card возит app-код (no_transit_cities) в УСПЕШНОМ 200-теле —
    // легаси-контракт TRIP-193, в корень result он не поднимается.
    if (last?.data?.svg || last?.data?.code) return last; // invoke-discriminant-exempt: app-код render-share-card едет в 200-теле (легаси TRIP-193)
    // eslint-disable-next-line no-await-in-loop
    if (attempt < tries - 1) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  return last;
}

// Фон карточки в SVG шаблона (обоих режимов) — ЕДИНСТВЕННЫЙ jpeg-data-URI
// (template.ts рисует его первым `<image>`; карта, самолётики и QR — png/svg).
// Подмена фона поэтому — замена этого URI, БЕЗ правки edge-функции: выбранный
// фон встаёт и в живое превью (overlay), и в финальный PNG (card_svg) прямо
// сейчас, против уже задеплоенного шаблона.
// ponytail: строковая хирургия — мост до серверного параметра фона; когда
// появится своя коллекция фонов (bg-параметр в render-share-card), подмену
// заменить на параметр запроса.
const BG_URI_RE = /data:image\/jpeg;base64,[^"']*/;

/** Штатный фон карточки из SVG шаблона — data-URI для миниатюры «Стандарт». */
export function cardBgUri(svg) {
  return svg?.match(BG_URI_RE)?.[0] || '';
}

/** Вернуть SVG карточки с подменённым фоном; пустой bgDataUri = штатный фон. */
export function applyCardBg(svg, bgDataUri) {
  if (!svg || !bgDataUri) return svg;
  return svg.replace(BG_URI_RE, bgDataUri);
}

// Картинка по URL → data-URI (для инлайна в SVG: canvas при растеризации не
// должен тейнтиться внешним href). Мемо на сессию — пресеты статичны.
const uriCache = new Map();
export function fetchImageDataUri(url) {
  if (!uriCache.has(url)) {
    const p = fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`bg fetch ${r.status}`); return r.blob(); })
      .then(blobToDataUri)
      .catch((e) => { uriCache.delete(url); throw e; });
    uriCache.set(url, p);
  }
  return uriCache.get(url);
}
