/**
 * emailPrefs — единственная дверь к настройкам почтовых рассылок (TRIP-512).
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
 */
import { HttpError, withHandler } from '../_shared/http.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_API = 'https://api.resend.com';

/** Куда отправить человека, открывшего адрес из заголовка письма браузером. */
const PREFS_PAGE = 'https://triplanio.com/email-preferences';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUBSCRIPTION = new Set(['opt_in', 'opt_out']);

type TopicRow = { id: string; name?: string; description?: string; subscription?: string };

/** Один вызов Resend. Бросает на не-2xx — тело ошибки наружу не уходит. */
async function resend(path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${RESEND_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`resend ${init.method ?? 'GET'} ${path} → ${res.status}`);
  return await res.json().catch(() => null);
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

  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed', 'METHOD');

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
  if (!id) throw new HttpError(400, 'Invalid unsubscribe link', 'INVALID_LINK');

  // ЧТЕНИЕ. Два вызова, потому что глобальный флаг живёт на контакте, а не в
  // списке топиков — а он главнее: при `unsubscribed: true` не уходит ничего,
  // как бы ни стояли топики. Страница, показывающая одни топики, врала бы.
  if (body?.action === 'get') {
    const [contact, topics] = await Promise.all([
      resend(`/contacts/${id}`) as Promise<{ unsubscribed?: boolean } | null>,
      resend(`/contacts/${id}/topics`) as Promise<TopicRow[] | null>,
    ]);
    return Response.json({
      unsubscribed: !!contact?.unsubscribed,
      topics: (Array.isArray(topics) ? topics : []).map((t) => ({
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
