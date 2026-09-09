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
 *
 * ★ ПОВТОРНЫЙ ДЕПЛОЙ ЭТОЙ ФУНКЦИИ ТРЕБУЕТ ИЗМЕНЕНИЯ ЕЁ БАЙТОВ (TRIP-527,
 * 09.09.2026). `supabase functions deploy` ПРОПУСКАЕТ функцию, у которой не
 * изменился хеш бандла: ручной прогон воркфлоу 08.09 отработал 57 секунд,
 * отчитался «success» — и не тронул НИ ОДНОЙ функции (в Management API у всех
 * `updated_at` остался прежним, у этой — `version 1`). То есть кнопка
 * «переразложить функции» существует, но она НИЧЕГО НЕ ДЕЛАЕТ, пока код тот же,
 * и «мы уже передеплоили» — ложный вывод, стоивший дня разбора.
 *
 * Зачем это понадобилось: на dev-проекте (`nydhzevdizkfaxdlikgc`) эта функция
 * отвечала `404 NOT_FOUND — Requested function was not found` на ЧАСТЬ запросов
 * — замер 09.09: 8 из 20 одинаковых POST подряд (40%), при этом на проде
 * (`tizscxrpuopobgcxbekf`) 40 из 40 чистых. Тело запроса ни при чём: 404 ловят
 * одинаковые запросы, а ретрай 3×300 мс их НЕ спасает (в прогоне планировщика
 * три вызова подряд упали всеми тремя попытками). Каждый такой 404 стоит
 * ПОЛНОГО круга модели (~5 с) — отсюда «ИИ отвечает минуту» на dev.
 */

import { readJson, refusalResponse, withHandler } from '../_shared/http.ts';
import { unwrapDbResult } from '../_shared/mutateRules.ts';
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
type Candidate = ReturnType<typeof toCandidate>;

Deno.serve(withHandler('gazetteerSearch', async (req, corsHeaders) => {
  const denied = requireN8nSecret(req);
  if (denied) return denied;

  const parsed = normalizeRequest(await readJson(req));
  if ('status' in parsed) return refusalResponse(parsed, corsHeaders);
  const { cities, language, limit } = parsed;

  // `supabase-js` не бросает — ошибка приезжает значением, и распаковывает её ТА
  // ЖЕ дверь, что у шва записи (`unwrapDbResult`): сбой справочника это инцидент
  // (500 + Sentry через `withHandler`), а не пустая выдача — «ничего не нашлось»
  // и «база не ответила» для агента разные ответы.
  const rows = unwrapDbResult(await supabaseAdmin.rpc('search_gazetteer_batch', {
    items: toRpcItems(cities),
    lang: language,
    lim: limit,
  })) as Record<string, unknown>[] | null;

  // Выдача выравнивается по ВХОДУ (`ord` 1:1, как у резолва фронта): агент
  // читает результат позиционно и не сопоставляет города по именам заново.
  // Поэтому ответ СТРОИТСЯ из входного списка, а строки лишь раскладываются по
  // своим позициям — выравнивание получается по построению, а не сверкой.
  // Пустой список = города с таким именем в этой стране нет. Агент вправе
  // попробовать другое написание или другой город — это его ход, не наш.
  const results = cities.map((c) => ({ city_name: c.city_name, candidates: [] as Candidate[] }));
  for (const row of rows || []) results[Number(row.ord) - 1]?.candidates.push(toCandidate(row));

  return Response.json({ results }, { headers: corsHeaders });
}));
