/**
 * emailPrefs — единственная дверь к настройкам почтовых рассылок (TRIP-513).
 *
 * Состояние подписки живёт в Resend (глобальный флаг `unsubscribed` на контакте
 * + подписки по топикам), НЕ у нас: колонки `users.notify_email_*` уже были и
 * умерли непрочитанными (миграция 20260802093550). Второй источник правды здесь
 * не заводится — функция только читает и пишет Resend.
 *
 * Адресат — `c`, id контакта Resend. Это UUID, который генерит Resend; в нашем
 * приложении он не появляется НИГДЕ (ни в API-ответах, ни на фронте, ни в БД),
 * поэтому взять его можно только из своего письма — он и есть неподделываемый
 * токен, как у любой ссылки отписки. Подпись поверх него ничего не добавляет.
 * В карте дверей (`scripts/ci/security-tiers.mjs`) это `token`, как getPublicTrip.
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
 *     Ставит ГЛОБАЛЬНЫЙ флаг, а не перебирает текущие топики: топик, заведённый
 *     позже, придёт с дефолтом opt_in и молча возобновил бы письма тому, кто
 *     нажал «Отписаться».
 *   • GET — человек открыл адрес из заголовка руками: 302 на страницу, ничего
 *     не меняя (GET не мутирует).
 *
 * Rate-limit сознательно НЕ ставится. Перебирать нечего (id — UUIDv4), усиления
 * нагрузки нет (два вызова Resend), а лимит по IP резал бы одноклик: почтовик
 * ходит с общих egress-адресов, и на всплеске отписок мы заблокировали бы ровно
 * то, что обязаны пропускать всегда.
 *
 * ЗАМЕРЕНО НА ЖИВОМ RESEND (04.09.2026), два факта, на которых стоит эта форма:
 *   • ЧАСТИЧНЫЙ массив топиков не трогает остальные — послали один топик, три
 *     соседних остались как были. Это и позволяет слать ТОЛЬКО тронутое и не
 *     затирать выбор, сделанный с другого устройства.
 *   • Глобальный флаг и топики ОРТОГОНАЛЬНЫ: `unsubscribed: true` не меняет ни
 *     одной подписки. Поэтому чтение — два вызова: экран, показывающий одни
 *     топики, о глобальном «не писать вовсе» не узнал бы.
 *
 * ⚠️ Неизвестный topic id Resend отбивает `404 Topic not found` — то есть ВЕСЬ
 * PATCH падает, а не только эта строка, и у нас это 500. Практически ловится
 * одним сценарием: топик удалили в дашборде, пока у человека открыта страница;
 * заново загруженный экран мёртвого id уже не пришлёт. Кода на это нет намеренно
 * — лечение (перечитать список на ошибке) стирало бы несохранённые переключения.
 */
import { HttpError, withHandler } from '../_shared/http.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_API = 'https://api.resend.com';

/** Куда отправить человека, открывшего адрес из заголовка письма браузером. */
const PREFS_PAGE = 'https://triplanio.com/email-preferences';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBSCRIPTION = new Set(['opt_in', 'opt_out']);

type TopicRow = { id: string; name?: string; description?: string; subscription?: string };

/**
 * Один вызов Resend. Бросает на не-2xx — тело ошибки наружу не уходит.
 * Форму ответа называет вызыватель параметром типа: `null` возможен всегда —
 * тело либо пустое, либо не JSON.
 */
async function resend<T = unknown>(path: string, init: RequestInit = {}): Promise<T | null> {
  const res = await fetch(`${RESEND_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`resend ${init.method ?? 'GET'} ${path} → ${res.status}`);
  return await res.json().catch(() => null) as T | null;
}

/**
 * Контакт-id из query или из тела. Query — путь почтовика (адрес зашит в
 * заголовок письма целиком); тело — путь нашей страницы, которая ходит через
 * same-origin `/api/*` и query таскать не обязана.
 */
function contactId(url: URL, body: Record<string, unknown> | null): string | null {
  const raw = String(body?.c ?? url.searchParams.get('c') ?? '').trim();
  return UUID_RE.test(raw) ? raw : null;
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
    if (UUID_RE.test(id) && SUBSCRIPTION.has(subscription)) out.push({ id, subscription });
  }
  return out;
}

Deno.serve(withHandler('emailPrefs', async (req, corsHeaders) => {
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
    if (id) await resend(`/contacts/${id}`, { method: 'PATCH', body: JSON.stringify({ unsubscribed: true }) });
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = contactId(url, body);
  if (!id) throw new HttpError(400, 'Invalid unsubscribe link', 'INVALID_INPUT');

  // ЧТЕНИЕ. Два вызова, потому что глобальный флаг живёт на контакте, а не в
  // списке топиков — а он главнее: при `unsubscribed: true` не уходит ничего,
  // как бы ни стояли топики. Страница, показывающая одни топики, врала бы.
  if (body?.action === 'get') {
    const [contact, topics] = await Promise.all([
      resend<{ unsubscribed?: boolean }>(`/contacts/${id}`),
      resend(`/contacts/${id}/topics`),
    ]);
    return Response.json({
      unsubscribed: !!contact?.unsubscribed,
      topics: listOf<TopicRow>(topics).map((t) => ({
        id: t.id,
        name: t.name ?? '',
        subscription: t.subscription === 'opt_out' ? 'opt_out' : 'opt_in',
      })),
    }, { headers: corsHeaders });
  }

  // ЗАПИСЬ. Пишем только присланное: страница шлёт топики всегда, а глобальный
  // флаг — лишь когда его трогали.
  const topics = cleanTopics(body?.topics);
  if (topics.length) {
    await resend(`/contacts/${id}/topics`, { method: 'PATCH', body: JSON.stringify(topics) });
  }
  if (typeof body?.unsubscribed === 'boolean') {
    await resend(`/contacts/${id}`, { method: 'PATCH', body: JSON.stringify({ unsubscribed: body.unsubscribed }) });
  }
  return Response.json({ ok: true }, { headers: corsHeaders });
}));
