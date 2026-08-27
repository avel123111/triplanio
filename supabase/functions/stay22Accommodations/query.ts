/**
 * Сборка querystring для Stay22 v2 — вынесена из обработчика ЧИСТОЙ функцией,
 * чтобы её пинал `deno test` без сети и без секретов (тот же приём, что
 * `getTripDetails/readGroup.ts`).
 *
 * ГЕО-РЕЖИМА У STAY22 ТРИ, и они дают РАЗНЫЕ выборки, а не разный масштаб одной:
 *
 *   · `address` — НЕ ИСПОЛЬЗУЕМ. Резолвит имя города в геометрический центр
 *     МУНИЦИПАЛИТЕТА, который у растянутых городов лежит вне города (Лос-Анджелес
 *     — 26 км, Токио — 132 км). Выпилен целиком, подробности в шапке `index.ts`.
 *
 *   · ТОЧКА `lat`/`lng` — «примерно 140 ближайших, но не дальше радиуса»
 *     (дефолтный радиус 10 км, API отдаёт его эхом в `_links.self`). В плотном
 *     городе счётчик выбирается за считанные километры: Лос-Анджелес — 139 штук
 *     в 6.4 км, Рим — 119 в 0.5 км. `radius` эту кляксу умеет только СЖИМАТЬ:
 *     на LA radius=60000 дал те же 139 и те же 6.4 км.
 *
 *   · ПРЯМОУГОЛЬНИК `nelat`/`nelng`/`swlat`/`swlng` — выборка, РАЗМАЗАННАЯ по
 *     площади. На LA даёт ~100 отелей с медианой 23 км от центра и НИ ОДНОГО
 *     общего с точечной выдачей. Это и есть способ покрыть большой город: не
 *     расширять точку, а спросить площадь.
 *
 * Клиент шлёт ОБА режима — разными запросами (см. `fetchStay22Round` во фронте):
 * в одном теле Stay22 читает одно гео, и когда пришли оба, здесь выигрывает
 * коробка. Точечная строка запроса при этом обязана оставаться той же, что была
 * до появления коробки, — это пинует тест «без коробки строка не изменилась».
 */

/** Тело запроса от клиента (всё необязательно, кроме гео — см. `locationError`). */
export type Stay22Body = {
  lat?: unknown; lng?: unknown;
  nelat?: unknown; nelng?: unknown; swlat?: unknown; swlng?: unknown;
  radius?: unknown; checkin?: unknown; checkout?: unknown;
  currency?: unknown; lang?: unknown; page?: unknown; pageSize?: unknown;
  adults?: unknown; children?: unknown; rooms?: unknown; provider?: unknown;
};

const AID = 'triplanio';
const CAMPAIGN = 'fork_api_search';
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;

const has = (v: unknown): boolean => v !== undefined && v !== null;

/** Прямоугольник считается заданным ТОЛЬКО целиком: три угла из четырёх — это
 *  оборванный запрос, и молча искать по точке вместо него значит соврать. */
export function hasBox(b: Stay22Body): boolean {
  return has(b.nelat) && has(b.nelng) && has(b.swlat) && has(b.swlng);
}

export function hasPoint(b: Stay22Body): boolean {
  return has(b.lat) && has(b.lng);
}

/**
 * Сообщение об ошибке, если гео не задано ни одним из принимаемых способов, иначе
 * null. Отдельной функцией, чтобы обработчик не решал это сам и текст не разъехался.
 */
export function locationError(b: Stay22Body): string | null {
  if (hasBox(b) || hasPoint(b)) return null;
  return 'lat/lng or the full nelat/nelng/swlat/swlng box is required';
}

/**
 * Собрать querystring к Stay22. Порядок параметров сохранён ровно тот, что был до
 * появления прямоугольника, — иначе «инертность» правки нельзя было бы пинать
 * сравнением строк.
 *
 * Когда пришли ОБА гео (и точка, и коробка), выигрывает КОРОБКА: явно названная
 * площадь — более сильное намерение, чем центр, который клиент шлёт всегда.
 */
export function buildStay22Query(b: Stay22Body): URLSearchParams {
  const safePageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(b.pageSize) || DEFAULT_PAGE_SIZE));
  const page = Number(b.page);

  const params = new URLSearchParams({
    pageSize: String(safePageSize),
    page: String(page > 0 ? page : 1),
    aid: AID,
    campaign: CAMPAIGN,
    cluster: 'false',
    adults: String(b.adults ?? 2),
    children: String(b.children ?? 0),
  });

  if (hasBox(b)) {
    params.set('nelat', String(b.nelat));
    params.set('nelng', String(b.nelng));
    params.set('swlat', String(b.swlat));
    params.set('swlng', String(b.swlng));
  } else {
    params.set('lat', String(b.lat));
    params.set('lng', String(b.lng));
  }

  // `radius` сужает точечный поиск и клиентом сейчас не шлётся: дефолт Stay22 в
  // 10 км сам подстраивается под плотность (в плотном городе выдача укладывается
  // в 0.5–1.5 км, в редком растягивается до 10 и захватывает соседние городки).
  if (b.radius) params.set('radius', String(b.radius));
  if (b.checkin) params.set('checkin', String(b.checkin));
  if (b.checkout) params.set('checkout', String(b.checkout));
  if (b.currency) params.set('currency', String(b.currency));
  if (b.lang) params.set('lang', String(b.lang));
  // Необязательные фильтры — только когда человек задал их в панели. `rooms` по
  // умолчанию опущен; `provider` у Stay22 сегодня принимает единственное значение
  // `booking` (проверено валидатором API), так что это фактически no-op-проброс.
  if (b.rooms) params.set('rooms', String(b.rooms));
  if (b.provider) params.set('provider', String(b.provider));

  return params;
}
