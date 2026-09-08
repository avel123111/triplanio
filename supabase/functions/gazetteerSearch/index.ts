/**
 * gazetteerSearch — ИНСТРУМЕНТ ИИ-АГЕНТА: поиск города в нашем справочнике.
 *
 * Front-end → planTripWithAi → n8n → (агент зовёт ЭТУ функцию) → geonameid в
 * операциях. Смысл и разбор имён — в шапке `request.ts`.
 *
 * ★ ЭТО ОТДЕЛЬНАЯ ФУНКЦИЯ, А НЕ ДЕЙСТВИЕ В СОСЕДНЕЙ, потому что у неё ДРУГАЯ
 * ДВЕРЬ АВТОРИЗАЦИИ: сюда ходит n8n с общим секретом (`requireN8nSecret`,
 * `verify_jwt = false` в `config.toml`), а `geoLocationiq` и прочий гео-путь
 * зовёт фронт под JWT пользователя. Смешать их значило бы снять `verify_jwt` с
 * функции, которую зовёт фронт, — то есть потерять проверку ради удобства.
 * Две модели авторизации в одном обработчике — источник дыр (TRIP-190).
 *
 * ★★ РАНЖИРОВАНИЕ ЗДЕСЬ НЕ ЖИВЁТ. Функция зовёт ТОТ ЖЕ `search_gazetteer_batch`
 * с тем же payload, что и фронт (`src/lib/geo.js` → `buildResolvePayload`), —
 * разница ровно в одном параметре `lim` (агенту нужны кандидаты, резолверу
 * фронта — один лучший). Иначе агент выбирал бы из одной выдачи, а фронт
 * проверял бы по другой, и мы завели бы второй источник правды ровно там, где
 * чиним первый.
 *
 * Отдельного rate-limit у функции НЕТ намеренно: сюда нельзя постучаться иначе
 * как в ходе обработки реплики, а на реплики лимит уже стоит (`planTripWithAi`,
 * 50/час на пользователя). Второй счётчик поверх первого ничего не закрывает.
 *
 * POST body: { cities: [{city_name, city_name_en?, country_code?}], language?, limit? }
 */

import { readJson, refusalResponse, withHandler } from '../_shared/http.ts';
import { requireN8nSecret } from '../_shared/n8nAuth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { normalizeRequest, toRpcItems } from './request.ts';

/** Строка справочника → словарь модели (имена как в операциях `OPS`). */
const toCandidate = (r: Record<string, unknown>) => ({
  geonameid: r.geonameid,
  city_name: r.display,
  // `subtitle` справочника — «регион, страна» на языке запроса. Именно по нему
  // модель отличает Портленд в Орегоне от Портленда в Мэне.
  region: r.subtitle,
  country_code: r.country_code,
  population: r.population,
  latitude: r.lat,
  longitude: r.lng,
});

Deno.serve(withHandler('gazetteerSearch', async (req, corsHeaders) => {
  const denied = requireN8nSecret(req);
  if (denied) return denied;

  const parsed = normalizeRequest(await readJson(req));
  if ('status' in parsed) return refusalResponse(parsed, corsHeaders);
  const { cities, language, limit } = parsed;

  const { data, error } = await supabaseAdmin.rpc('search_gazetteer_batch', {
    items: toRpcItems(cities),
    lang: language,
    lim: limit,
  });
  // `supabase-js` не бросает — ошибка приезжает значением; сбой справочника это
  // инцидент (500 + Sentry через withHandler), а не пустая выдача: «ничего не
  // нашлось» и «база не ответила» для агента разные ответы.
  if (error) throw error;

  // Выдача выравнивается по ВХОДУ (`ord` 1:1, как у резолва фронта): агент
  // читает результат позиционно и не сопоставляет города по именам заново.
  const byOrd = new Map<number, ReturnType<typeof toCandidate>[]>();
  for (const row of (data || []) as Record<string, unknown>[]) {
    const ord = Number(row.ord);
    const list = byOrd.get(ord) || [];
    list.push(toCandidate(row));
    byOrd.set(ord, list);
  }

  return Response.json({
    results: cities.map((c, i) => ({
      city_name: c.city_name,
      // Пустой список = города с таким именем в этой стране нет. Агент вправе
      // попробовать другое написание или другой город — это его ход, не наш.
      candidates: byOrd.get(i + 1) || [],
    })),
  }, { headers: corsHeaders });
}));
