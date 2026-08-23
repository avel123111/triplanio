// getTrips — ярус B эпика «единая дверь в данные» (TRIP-403, домен главной).
//
// Композит главной (/trips): отдаёт трипы вызывающего как ПОЛНЫЕ карточки одним
// вызовом — список + owner-aware is_pro (БЕЙДЖ отсюда, не размазан) + моя роль +
// визиты + участники (стопка аватаров, owner первым). Заменяет на главной три
// чтения: прямой `.from('trips')`, RPC профилей участников и карточные слайсы
// getTravelStats (обложка/бейдж/визиты). Читает /trips (react-query).
//
// ★ Актор — из JWT, не из тела. RPC get_my_trip_cards принимает явный p_actor:
// под service_role её внутренний auth.uid() был бы NULL. p_actor берём ТОЛЬКО из
// проверенного токена → чужие карточки недостижимы (клиент p_actor не называет,
// EXECUTE у клиентских ролей снят в миграции). IDOR закрыт в самом запросе RPC
// (возвращаются только трипы актора: owner ИЛИ active-member).
//
// Возвращает массив карточек: тело RPC + `myStep` (ступень вызывающего, см. ниже
// у самого маппинга). verify_jwt=true дефолтом
// (аутентификация через getRequestUser, как getMe/getTravelStats/getActiveTrips)
// — записи в config.toml не нужно.

import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin, requireUser } from '../_shared/supabaseAdmin.ts';
import { stepFromFacts } from '../_shared/tripStep.ts';

Deno.serve(withHandler('getTrips', async (req, corsHeaders) => {
  const user = await requireUser(req);

  // `error` здесь = только инфра-сбой БД → throw → 500 INTERNAL (ретраится, летит
  // в Sentry). Бизнес-ответа-«нет» у этого чтения нет: пустой набор — это валидный
  // `[]`, который вернёт сама RPC.
  const { data, error } = await supabaseAdmin.rpc('get_my_trip_cards', { p_actor: user.id });
  if (error) throw error;

  // Каждой карточке — СТУПЕНЬ вызывающего, тем же правилом `stepFromFacts`, что
  // стоит за `callerStep` у двери трипа. Зачем: состав меню трипа решают ступень
  // + аддоны, и если главная везёт оба факта, экран открывается с готовым меню,
  // не дожидаясь `getTripDetails`.
  //
  // Правило НЕ копируется ни в SQL (там его нет и заводить нельзя), ни на клиент
  // (оттуда его сняли вместе с FE-зеркалом ролей) — у одного правила просто стало
  // два вызывателя.
  //
  // `{ role }` без ветвления на создателя — намеренно: карточка возвращается
  // ТОЛЬКО для трипов, где актор создатель или АКТИВНЫЙ участник, поэтому строка
  // членства всегда существует, а для создателя правило коротко замыкается на
  // `created_by` и роль не читает вовсе. Пустая роль при живой строке — это
  // `participant` (та самая разница «строки нет» ≠ «роль пустая», TRIP-274).
  const cards = (data ?? []) as Array<Record<string, unknown>>;
  const withStep = cards.map((card) => ({
    ...card,
    myStep: stepFromFacts(
      (card.created_by as string | null) ?? null,
      user.id,
      { role: (card.role as string | null) ?? null },
    ),
  }));

  return Response.json(withStep, { headers: corsHeaders });
}));
