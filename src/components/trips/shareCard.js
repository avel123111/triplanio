import { invokeFn } from '@/lib/invokeFn';
import { blobToDataUri } from '@/lib/map/captureMap';

// Чистая строковая хирургия фона живёт отдельным модулем (тестируется под
// node --test без mapbox/supabase-цепочки); здесь — только IO конструктора.
export { applyCardBg } from '@/lib/shareCardBg';

// Must match MAP_TOKEN in the render-share-card edge function (card_svg mode).
export const MAP_PLACEHOLDER = '__SHARE_CARD_MAP__';

// Флаги стран в ряду «Visited Countries» рисует edge токенами `__SC_FLAG_<cc>__`
// (в рантайме у функции нет доступа к public/flags). Клиент инлайнит /flags/<cc>.svg
// в data-URI — тем же механизмом, что карту/фон (canvas при растеризации не тейнтится
// внешним href). Промах флага → пустой href (белый круг остаётся). Кэш общий с фоном.
const FLAG_TOKEN_RE = /__SC_FLAG_([a-z]{2})__/g;
export async function inlineFlags(svg) {
  // includes (не FLAG_TOKEN_RE.test): у /g-регэкспа test двигает lastIndex —
  // stateful-страж между вызовами. Дешёвая подстрока-проверка без состояния.
  if (!svg || !svg.includes('__SC_FLAG_')) return svg;
  const codes = [...new Set([...svg.matchAll(FLAG_TOKEN_RE)].map((m) => m[1]))];
  const entries = await Promise.all(codes.map((cc) =>
    fetchImageDataUri(`/flags/${cc}.svg`).then((uri) => [cc, uri]).catch(() => [cc, ''])));
  const byCc = new Map(entries);
  return svg.replace(FLAG_TOKEN_RE, (_, cc) => byCc.get(cc) || '');
}

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

// Картинка по URL → data-URI (для инлайна в SVG: canvas при растеризации не
// должен тейнтиться внешним href). Мемо на сессию — пресеты статичны.
// maxBytes — тот же кэп, что у загрузки своего фото: фон едет data-URI прямо
// в SVG, тяжелее — растеризация встанет; провал сбрасывает кэш для ретрая.
const uriCache = new Map();
export function fetchImageDataUri(url, maxBytes = 0) {
  if (!uriCache.has(url)) {
    const p = fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`bg fetch ${r.status}`); return r.blob(); })
      .then((blob) => {
        if (maxBytes && blob.size > maxBytes) throw new Error(`bg too large: ${blob.size}`);
        return blobToDataUri(blob);
      })
      .catch((e) => { uriCache.delete(url); throw e; });
    uriCache.set(url, p);
  }
  return uriCache.get(url);
}
