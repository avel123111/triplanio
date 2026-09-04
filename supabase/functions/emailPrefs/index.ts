/**
 * emailPrefs — единственная дверь к настройкам почтовых рассылок (TRIP-513).
 *
 * Состояние подписки живёт в Resend (глобальный флаг `unsubscribed` на контакте
 * + подписки по топикам), НЕ у нас: колонки `users.notify_email_*` уже были и
 * умерли непрочитанными (миграция 20260802093550). Второй источник правды здесь
 * не заводится — функция только читает и пишет Resend.
 *
 * АДРЕСАТА функция определяет сама, двумя способами — из письма по `c` или из
 * сессии залогиненного. Ни в одном фронт не передаёт чужой идентификатор; правило
 * целиком в `resolveContact`, там же и обоснование. В карте дверей
 * (`scripts/ci/security-tiers.mjs`) это `token` — по слабейшему из двух входов.
 *
 * ⚠️ `c` обязан быть UUID. Resend адресует контакт как `{id_or_email}`, то есть
 * с адресом в этом параметре ссылка превратилась бы в «отпиши кого угодно, зная
 * почту». Всё, что не UUID, отбивается до первого обращения к Resend.
 *
 * Три входа, различаются методом и Content-Type:
 *   • POST + JSON `{action:'get'}`          — наша страница читает состояние;
 *   • POST + JSON `{topics?,unsubscribed?}` — наша страница пишет;
 *   • POST + form-urlencoded                — ОДНОКЛИК почтовика (RFC 8058): тело
 *     `List-Unsubscribe=One-Click`, человека и браузера нет, ответ — пустой 200.
 *     Делает то же, что переключатель «не писать вовсе» на странице, — одним
 *     правилом `stopEverything` (см. его докблок).
 *   • GET — человек открыл адрес из заголовка руками: 302 на страницу, ничего
 *     не меняя (GET не мутирует).
 *
 * Rate-limit сознательно НЕ ставится. Перебирать нечего (id — UUIDv4), усиления
 * нагрузки нет (два вызова Resend), а лимит по IP резал бы одноклик: почтовик
 * ходит с общих egress-адресов, и на всплеске отписок мы заблокировали бы ровно
 * то, что обязаны пропускать всегда.
 *
 * ЗАМЕРЕНО НА ЖИВОМ RESEND (04.09.2026) — и первый замер был ЛОЖНЫМ, что и
 * стоило прод-бага. Тогда записали один топик, увидели три соседних нетронутыми
 * и прочли это как «частичный массив не трогает остальные». На деле не изменился
 * НИ ОДИН, включая посланный. Ноль изменений выглядит как «изменилось ровно
 * посланное», если посланное совпадало с текущим, — наблюдение подтверждало
 * вывод, будучи с ним не связано.
 *
 * ЧТО ИЗВЕСТНО ТОЧНО (перемер, тот же день):
 *   • `PATCH /contacts/{id}/topics` НАШИМ ключом отвечает 2xx и не применяет
 *     ничего — ни `opt_out`, ни `opt_in`, на любом числе топиков и на разных
 *     контактах. Форма тела совпадает с curl из доки.
 *   • ТОТ ЖЕ вызов сторонним клиентом (OAuth-грант того же аккаунта) применяется
 *     МГНОВЕННО, и наше чтение видит результат тут же. Значит ни форма тела, ни
 *     эндпоинт, ни кэш чтения ни при чём — расходятся УЧЁТНЫЕ ДАННЫЕ.
 *   • `PATCH /contacts/{id}` (`unsubscribed`) нашим же ключом ПИШЕТ. То есть это
 *     не «ключ только на чтение», а разница по КОНКРЕТНОЙ ручке.
 *   • `POST /contacts` с полем `topics` подписки пишет — при СОЗДАНИИ контакта.
 *   • гейт отправки по топику работает: письмо под топиком с
 *     `default_subscription: opt_out` уходит в `failed`.
 *
 * Рабочая версия (НЕ доказана): ключ выпущен до появления Topics и на эту ручку
 * права не несёт, а Resend вместо 403 отвечает 200 — тогда лечится выпуском
 * нового ключа. Доказать её здесь нечем: причина видна только в ТЕЛЕ ответа,
 * которое мы прежде выбрасывали. Теперь оно едет в Sentry (`ResendError.body`),
 * поэтому следующее срабатывание `writeTopics` назовёт причину само.
 *
 * Следствие для продукта: пока запись не проходит, отписка по топикам не
 * срабатывает. Наше дело — не врать об этом (см. `writeTopics`).
 *
 * ⚠️ Неизвестный topic id Resend отбивает `404 Topic not found` — то есть ВЕСЬ
 * PATCH падает, а не только эта строка, и у нас это 500. Практически ловится
 * одним сценарием: топик удалили в дашборде, пока у человека открыта страница;
 * заново загруженный экран мёртвого id уже не пришлёт. Кода на это нет намеренно
 * — лечение (перечитать список на ошибке) стирало бы несохранённые переключения.
 */
import { HttpError, jsonError, withHandler } from '../_shared/http.ts';
import { captureEdgeError } from '../_shared/sentry.ts';
import { getRequestUser, supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { isUuid } from '../_shared/uuid.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_API = 'https://api.resend.com';

/** Куда отправить человека, открывшего адрес из заголовка письма браузером. */
const PREFS_PAGE = 'https://triplanio.com/email-preferences';

const SUBSCRIPTION = new Set(['opt_in', 'opt_out']);

type TopicRow = { id: string; name?: string; description?: string; subscription?: string };

/**
 * Отказ ЧУЖОГО сервиса, отличимый от нашей ошибки. Несёт путь и статус, чтобы
 * событие в Sentry можно было сгруппировать по ним, а не по общему стеку, — и
 * ТЕЛО ответа, потому что без него отказ Resend неотличим от отказа Resend.
 *
 * Тело здесь не роскошь: `PATCH /contacts/{id}/topics` тем же ключом отвечает
 * 2xx и не применяет ничего, тогда как сторонний клиент на тех же данных пишет
 * штатно. Причина видна только в теле, а мы его выбрасывали — и разбор упёрся
 * в стену, на которой снаружи не написано НИЧЕГО. Наружу оно по-прежнему не
 * уходит: только в Sentry, обрезанное.
 */
class ResendError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(`resend ${method} ${path} → ${status}`);
    this.name = 'ResendError';
  }
}

/** Тело ответа для диагностики: текстом и коротко — в Sentry, не пользователю. */
function peek(text: string): string {
  return text.slice(0, 500);
}

/**
 * Один вызов Resend. Бросает на не-2xx — тело ошибки наружу не уходит.
 * Форму ответа называет вызыватель параметром типа: `null` возможен всегда —
 * тело либо пустое, либо не JSON.
 */
async function resend<T = unknown>(path: string, init: RequestInit = {}, allow404 = false): Promise<T | null> {
  const res = await fetch(`${RESEND_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 404 && allow404) return null;
  // Тело читается ОДИН раз и текстом: `Response` — поток, второй `json()` достал
  // бы уже вычерпанный (та же грабля, что на фронте с `parseEdgeError`).
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new ResendError(init.method ?? 'GET', path, res.status, peek(text));
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Контакт-id из query или из тела. Query — путь почтовика (адрес зашит в
 * заголовок письма целиком); тело — путь нашей страницы, которая ходит через
 * same-origin `/api/*` и query таскать не обязана.
 */
function contactId(url: URL, body: Record<string, unknown> | null): string | null {
  const raw = String(body?.c ?? url.searchParams.get('c') ?? '').trim();
  return isUuid(raw) ? raw : null;
}

/**
 * Список из ответа Resend.
 *
 * ★ ЗАМЕРЕНО КУРЛОМ ПО ЖИВОЙ ФУНКЦИИ (04.09.2026), и это стоило бага в dev:
 * коллекционные ручки Resend отдают НЕ голый массив, а конверт
 * `{ object: "list", has_more, data: [...] }`. Прежний `Array.isArray(x) ? x : []`
 * поэтому возвращал ПУСТО ВСЕГДА — страница рисовала ноль топиков у контакта,
 * у которого их четыре, и не падала: пустой список выглядит как «топиков нет».
 *
 * Тестами это не ловилось по построению: юнит-тест кормил `buildRows` массивом,
 * набранным руками, а живую форму я смотрел через инструмент, который печатал её
 * СПИСКОМ, а не сырым телом. Увидеть можно было только сырым HTTP.
 *
 * Одиночные ручки (`GET /contacts/{id}`) конверта НЕ имеют — проверено тем же
 * запросом: `unsubscribed` пришёл с верхнего уровня и совпал с дашбордом.
 */
function listOf<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  const data = (payload as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data as T[] : [];
}

/** Оставить только валидные пары; чужие ключи и статусы отбрасываются. */
function cleanTopics(input: unknown): Array<{ id: string; subscription: string }> {
  if (!Array.isArray(input)) return [];
  const out: Array<{ id: string; subscription: string }> = [];
  for (const row of input) {
    const id = String((row as TopicRow)?.id ?? '');
    const subscription = String((row as TopicRow)?.subscription ?? '');
    if (isUuid(id) && SUBSCRIPTION.has(subscription)) out.push({ id, subscription });
  }
  return out;
}

/**
 * КОНТАКТ ПО АДРЕСУ: найти, а если его нет — завести.
 *
 * Заводить обязательно, а не «ошибка, контакта нет»: контакты сегодня рождаются
 * только в welcome-ветке n8n, то есть у всех, кто зарегистрировался раньше, их
 * не существует. Без создания экран настроек был бы им недоступен, а разовая
 * заливка всех адресов — работа, которую эта строка делает сама и по факту
 * обращения.
 */
async function contactIdByEmail(email: string): Promise<string> {
  const found = await resend<{ id?: string }>(`/contacts/${encodeURIComponent(email)}`, {}, true);
  if (found?.id) return found.id;
  const made = await resend<{ id?: string }>('/contacts', { method: 'POST', body: JSON.stringify({ email }) });
  if (!made?.id) throw new Error('resend: contact create returned no id');
  return made.id;
}

/**
 * КТО ПРИШЁЛ. Два входа на один экран, и НИ В ОДНОМ фронт не передаёт чужой
 * идентификатор:
 *
 *   • ИЗ ПИСЬМА — `c`, id контакта. Он и есть пропуск: id генерит Resend, в
 *     приложении он не появляется нигде, взять его можно только из письма,
 *     адресованного этому человеку. Входа без логина требуют почтовики.
 *
 *   • ИЗ АККАУНТА — сессия. Личность берётся из ПРОВЕРЕННОГО токена, а НЕ из
 *     тела запроса. Приняв id пользователя параметром, мы бы отдали чужие
 *     настройки любому, кто этот id видел, — а он уезжает на фронт в списке
 *     участников трипа (`src/lib/resolveAuthor.js`). Функция стоит
 *     `verify_jwt = false` (иначе шлюз отбил бы одноклик почтовика), поэтому
 *     токен проверяет она сама — так же, как остальные наши self-auth функции.
 *
 * Адрес берём из `public.users`, а НЕ из токена: письма шлёт n8n по ЭТОЙ строке
 * (PG-триггер отдаёт её payload). Разъедься эти два адреса — мы правили бы
 * подписки контакта, которому ничего не отправляется.
 */
async function resolveContact(req: Request, url: URL, body: Record<string, unknown> | null): Promise<string> {
  const fromLink = contactId(url, body);
  if (fromLink) return fromLink;

  const user = await getRequestUser(req);
  if (!user) throw new HttpError(400, 'Invalid unsubscribe link', 'INVALID_INPUT');

  const { data: row, error } = await supabaseAdmin
    .from('users').select('email').eq('id', user.id).maybeSingle();
  if (error) throw error;
  const email = String(row?.email ?? '').trim();
  // Пусто — аккаунт обезличен (soft-delete, TRIP-78): адреса нет, править нечего.
  if (!email) throw new HttpError(400, 'Invalid unsubscribe link', 'INVALID_INPUT');

  return await contactIdByEmail(email);
}

/** Подписки контакта, как их видит Resend. Один разбор конверта на все три места. */
async function readTopics(id: string): Promise<TopicRow[]> {
  return listOf<TopicRow>(await resend(`/contacts/${id}/topics`));
}

/**
 * ЗАПИСЬ ПОДПИСОК — И СВЕРКА, ЧТО ОНА СОСТОЯЛАСЬ.
 *
 * Перечитывать после записи не «на всякий случай»: ровно этот вызов отвечает
 * 2xx и НЕ ПРИМЕНЯЕТ НИЧЕГО (замер в шапке файла). Без сверки экран говорил
 * «Сохранено» человеку, который остался подписан, — на отписке это худший из
 * возможных обманов: следующим его действием будет «Спам», а он бьёт по
 * репутации домена, то есть заодно по приглашениям и сбросу пароля.
 *
 * Молчаливый отказ мы поэтому приравниваем к отказу ЯВНОМУ и репортим тем же
 * путём — `ResendError` со статусом 200. Статуса 200 у настоящего отказа не
 * бывает, поэтому в Sentry этот случай отделён от 4xx/5xx собственным issue
 * фингерпринтом, а маркер в пути читается прямо в заголовке события.
 *
 * Сверяем ТОЛЬКО посланное: остальные подписки нас в этом запросе не касаются,
 * и требовать от них неизменности значило бы падать на чужой правке, сделанной
 * с другого устройства между записью и перечитыванием.
 */
async function writeTopics(id: string, want: Array<{ id: string; subscription: string }>): Promise<void> {
  if (!want.length) return;
  const answered = await resend(`/contacts/${id}/topics`, { method: 'PATCH', body: JSON.stringify(want) });

  const have = new Map<string, string | undefined>();
  for (const row of await readTopics(id)) have.set(row.id, row.subscription);
  if (want.some((w) => have.get(w.id) !== w.subscription)) {
    throw new ResendError(
      'PATCH',
      '/contacts/{id}/topics [ответил ок, не применил]',
      200,
      peek(JSON.stringify(answered)),
    );
  }
}

/**
 * «НЕ ПИСАТЬ ВОВСЕ» — одно правило на оба входа: кнопку почтовика и переключатель
 * на странице. Ставит глобальный флаг И выключает ВСЕ топики.
 *
 * ЗАЧЕМ ОБА, а не только флаг. Дока Resend описывает `unsubscribed` как «отписан
 * от BROADCASTS» — их массовых рассылок из дашборда. Мы такими не пользуемся: n8n
 * шлёт обычные письма через `/emails`, и гейтит ли их этот флаг, не сказано
 * НИГДЕ. Про топики неопределённости нет — дока `/emails` прямо пишет: контакт
 * отписан от топика → письмо не отправляется и помечается `failed`.
 *
 * Значит одного флага мало: человек нажал «Отписаться» в почтовике, мы честно
 * его поставили, а письма продолжают идти — и следующим нажатием будет «Спам»,
 * который бьёт по репутации домена, то есть заодно по приглашениям и сбросу
 * пароля. Выключая ещё и топики, мы опираемся на гарантию, которая ДОКУМЕНТИРОВАНА,
 * и правильны при любом поведении флага. Цена — один лишний вызов.
 *
 * Обратное действие НЕ зеркально: снятие флага топики обратно не включает.
 * Восстановить прежний набор нечем — он затёрт, а «включить всё» вернуло бы
 * человеку то, от чего он раньше отписывался сам. Поэтому он просто видит
 * выключенные переключатели и включает те, что хочет.
 */
async function stopEverything(id: string): Promise<void> {
  await writeTopics(id, (await readTopics(id)).filter((t) => t?.id).map((t) => ({ id: t.id, subscription: 'opt_out' })));
  await resend(`/contacts/${id}`, { method: 'PATCH', body: JSON.stringify({ unsubscribed: true }) });
}

/**
 * Отказ Resend — ЧУЖОЙ сбой, и отчитывается он по образцу `geoLocationiq`, а не
 * общим 500 `INTERNAL`:
 *
 *   • свой `captureEdgeError` с путём и статусом — без них все отказы Resend
 *     (404, 429, 5xx, любая ручка) склеиваются в ОДИН issue: `throw` у них
 *     общий, а Sentry группирует по стеку. Ровно та же беда, что уже лечили
 *     фингерпринтом в TRIP-441;
 *   • `fingerprint` = fn + `resend` + статус — разводит их по разным issue;
 *   • ответ 502, а не 500: сломались не мы, и человеку «повторить» ПОМОЖЕТ
 *     (страница на любую не-INVALID_INPUT ошибку показывает кнопку повтора);
 *   • `x-sentry-skip` — событие уже отправлено здесь, с контекстом; без него
 *     `withHandler` отрепортил бы его вторым, беднее.
 *
 * Почтовику 502 отдаётся осознанно: если Resend лежит, отписка ДЕЙСТВИТЕЛЬНО не
 * состоялась, и ответить ему 200 значило бы соврать — человек остался бы
 * подписан, считая, что отписался.
 */
Deno.serve(withHandler('emailPrefs', async (req, corsHeaders) => {
  try {
    return await handle(req, corsHeaders);
  } catch (e) {
    if (!(e instanceof ResendError)) throw e;
    await captureEdgeError(
      e,
      'emailPrefs',
      { resend_method: e.method, resend_path: e.path, resend_status: e.status, resend_body: e.body },
      undefined,
      ['emailPrefs', 'resend', String(e.status)],
    );
    return jsonError(502, 'Email service unavailable', 'INTERNAL', { ...corsHeaders, 'x-sentry-skip': '1' });
  }
}));

async function handle(req: Request, corsHeaders: HeadersInit): Promise<Response> {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
  const url = new URL(req.url);

  // Человек открыл адрес из заголовка руками. GET ничего не меняет — уводим на
  // страницу, где он увидит и переключит всё осознанно.
  if (req.method === 'GET') {
    const id = contactId(url, null);
    const to = id ? `${PREFS_PAGE}?c=${encodeURIComponent(id)}` : PREFS_PAGE;
    return new Response(null, { status: 302, headers: { ...corsHeaders, Location: to } });
  }

  // Кодов НОВЫХ здесь нет намеренно: реестр `_shared/errorCodes.ts` append-only
  // (код живёт в сторе дольше нашего релиза), и заводить в нём синоним к тому,
  // что уже есть, дороже, чем переиспользовать. 405 — это `BAD_REQUEST`,
  // «в `c` не id контакта» — `INVALID_INPUT`; страница ветвится по второму, а
  // первого от неё не приходит вовсе.
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed', 'BAD_REQUEST');

  // ОДНОКЛИК почтовика: RFC 8058 предписывает form-urlencoded тело
  // `List-Unsubscribe=One-Click`. Тела JSON у него не бывает — по типу и
  // различаем, а не по «пустое/непустое».
  if ((req.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded')) {
    const id = contactId(url, null);
    // Ответ почтовику всегда 200 с пустым телом (RFC 8058): человеку он не
    // показывает ни ошибку, ни страницу, а не-2xx трактует как «отписка не
    // сработала» и понижает доверие к отправителю.
    if (id) await stopEverything(id);
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = await resolveContact(req, url, body);

  // ЧТЕНИЕ. Два вызова, потому что глобальный флаг живёт на контакте, а не в
  // списке топиков — а он главнее: при `unsubscribed: true` не уходит ничего,
  // как бы ни стояли топики. Страница, показывающая одни топики, врала бы.
  if (body?.action === 'get') {
    const [contact, topics] = await Promise.all([
      resend<{ unsubscribed?: boolean }>(`/contacts/${id}`),
      readTopics(id),
    ]);
    return Response.json({
      unsubscribed: !!contact?.unsubscribed,
      topics: topics.map((t) => ({
        id: t.id,
        name: t.name ?? '',
        subscription: t.subscription === 'opt_out' ? 'opt_out' : 'opt_in',
      })),
    }, { headers: corsHeaders });
  }

  // ЗАПИСЬ. «Не писать вовсе» — то же правило, что у кнопки почтовика: правило
  // живёт ЗДЕСЬ, а не в двух местах, и страница о нём знать не обязана. Частные
  // переключатели при нём не применяются — они уже ничего не решают, и применить
  // их поверх значило бы записать состояние, которого человек не выбирал.
  if (body?.unsubscribed === true) {
    await stopEverything(id);
    return Response.json({ ok: true }, { headers: corsHeaders });
  }

  // Иначе — пишем только присланное: страница шлёт ТРОНУТЫЕ топики, а флаг лишь
  // когда его сняли.
  await writeTopics(id, cleanTopics(body?.topics));
  if (body?.unsubscribed === false) {
    await resend(`/contacts/${id}`, { method: 'PATCH', body: JSON.stringify({ unsubscribed: false }) });
  }
  return Response.json({ ok: true }, { headers: corsHeaders });
}
