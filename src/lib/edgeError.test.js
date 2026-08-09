import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEdgeError, edgeErrorMessage } from './edgeError.js';

// Что тут пиньтся (TRIP-378). Две edge-функции перестали отвечать 200 на отказ:
// `updateTripSettings` шлёт 403 `FORBIDDEN` / 402 `PRO_REQUIRED`, `deleteTrip` -
// 403 / 404, обе - 500 `INTERNAL` на сбой запроса. У поведения клиента после
// такого флипа НЕТ ни скриншота, ни гарда: единственный гейт - этот тест.
//
// ГЛАВНОЕ, что он держит: `код отказа обязан пережить не-2xx`. supabase-js на
// не-2xx оставляет `data` пустым и кладёт тело в `error.context` (Response),
// поэтому ветка по `data.code` перестаёт совпадать МОЛЧА - ошибка не бросается,
// экран не падает, просто вместо Pro-апселла показывается тост «не сохранилось».
//
// Формы ошибок - как в loadStateClassify.test.js / query-client.test.js: руками,
// без импорта `@supabase/functions-js` (он транзитивная зависимость). Тело тут
// обязано быть НАСТОЯЩИМ Response: `parseEdgeError` читает его через `.json()`.
// Дословное сообщение FunctionsHttpError - замерено в
// node_modules/@supabase/functions-js/dist/module/types.js:69. Именно оно уходило
// бы в тост, если бы вызыватель читал `error.message` вместо разобранного тела.
const SDK_NON_2XX = 'Edge Function returned a non-2xx status code';
const httpErr = (status, body) => Object.assign(new Error(SDK_NON_2XX), {
  name: 'FunctionsHttpError',
  context: new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
});

// ── код переживает не-2xx ─────────────────────────────────────────────────────
// Ровно те ответы, которые теперь отдают обе функции.
for (const [name, status, body, wantCode] of [
  ['updateTripSettings · нет прав',   403, { error: 'Forbidden', code: 'FORBIDDEN' }, 'FORBIDDEN'],
  ['updateTripSettings · нужен Pro',  402, { error: 'Pro required', code: 'PRO_REQUIRED' }, 'PRO_REQUIRED'],
  ['updateTripSettings · нет трипа',  404, { error: 'Trip not found', code: 'NOT_FOUND' }, 'NOT_FOUND'],
  ['deleteTrip · не владелец',        403, { error: 'Forbidden', code: 'FORBIDDEN' }, 'FORBIDDEN'],
  ['deleteTrip · трипа нет',          404, { error: 'Not found', code: 'NOT_FOUND' }, 'NOT_FOUND'],
  ['сбой запроса → 500',              500, { error: 'canceling statement due to statement timeout', code: 'INTERNAL' }, 'INTERNAL'],
]) {
  test(`parseEdgeError: код доезжает через не-2xx — ${name}`, async () => {
    const { code, message } = await parseEdgeError(httpErr(status, body), null);
    assert.equal(code, wantCode);
    // И сообщение - серверное, а не строка SDK: `parseEdgeError` её отфильтровывает.
    assert.equal(message, body.error);
    assert.notEqual(message, SDK_NON_2XX);
  });
}

// ── регрессия, ради которой заведён весь тикет ────────────────────────────────
test('★ у не-2xx `data` пуст, поэтому ветка по data.code молча промахивается', async () => {
  const err = httpErr(402, { error: 'Pro required', code: 'PRO_REQUIRED' });
  const data = null; // supabase-js на не-2xx: `{ data: null, error }`

  // Как было до TRIP-378 (сервер отвечал 200, код лежал в `data`).
  assert.equal(data?.code === 'PRO_REQUIRED', false, 'прежняя ветка обязана НЕ совпасть — иначе тест ничего не доказывает');

  // Как стало: код читается из разобранного тела.
  const { code } = await parseEdgeError(err, data);
  assert.equal(code, 'PRO_REQUIRED');
});

test('★ «нужен Pro» и «нет прав» остаются РАЗЛИЧИМЫ после флипа', async () => {
  const pro = await parseEdgeError(httpErr(402, { error: 'Pro required', code: 'PRO_REQUIRED' }), null);
  const forbidden = await parseEdgeError(httpErr(403, { error: 'Forbidden', code: 'FORBIDDEN' }), null);
  assert.notEqual(pro.code, forbidden.code);
});

// ── сырой английский текст SDK не доходит до пользователя ─────────────────────
test('★ строка SDK «non-2xx» отфильтрована, а не показана', async () => {
  const err = httpErr(403, { error: 'Forbidden', code: 'FORBIDDEN' });
  assert.equal(err.message, SDK_NON_2XX, 'датчик: это и есть то, что ушло бы в тост');
  const msg = await edgeErrorMessage(err, null, 'fallback');
  assert.notEqual(msg, SDK_NON_2XX);
});

test('тело не по контракту (платформенный отказ) → code null, fallback', async () => {
  // Холодный старт / OOM / 546: `withHandler` не отработал, тела `{error,code}` нет.
  const err = Object.assign(new Error(SDK_NON_2XX), {
    name: 'FunctionsHttpError',
    // Не UI-строка, а тело чужого ответа: шлюз отдаёт HTML-страницу, а не наш
    // JSON, — на её угловые скобки гард 2d срабатывает как на JSX-текст.
    context: new Response('<html>gateway timeout</html>', { status: 504 }), // i18n-ignore
  });
  const { code, message } = await parseEdgeError(err, null);
  assert.equal(code, null);
  assert.equal(message, null, 'строка SDK не должна подменять собой причину');
  assert.equal(await edgeErrorMessage(err, null, 'fallback'), 'fallback');
});

test('200 с { error } (функция вне канона) по-прежнему разбирается из data', async () => {
  // Форма, которую держат остальные 188 неканонических ответов (метрика M4 гарда
  // 2r после этого PR) до кодемода формы — TRIP-374, Р4 §0(F).
  const { code, message } = await parseEdgeError(null, { error: 'rate limited', code: 'RATE_LIMITED' });
  assert.equal(code, 'RATE_LIMITED');
  assert.equal(message, 'rate limited');
});
