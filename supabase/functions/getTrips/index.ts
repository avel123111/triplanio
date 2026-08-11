// getTrips — ярус B эпика «единая дверь в данные» (TRIP-403, домен главной).
//
// Композит главной (/trips): отдаёт трипы вызывающего как ПОЛНЫЕ карточки одним
// вызовом — список + owner-aware is_pro (БЕЙДЖ отсюда, не размазан) + моя роль +
// визиты + участники (стопка аватаров, owner первым). Заменяет на главной три
// чтения: прямой `.from('trips')`, `.rpc('get_trip_participant_profiles')` и
// карточные слайсы getTravelStats (обложка/бейдж/визиты). Читает /trips (react-query).
//
// ★ Актор — из JWT, не из тела. RPC get_my_trip_cards принимает явный p_actor:
// под service_role её внутренний auth.uid() был бы NULL. p_actor берём ТОЛЬКО из
// проверенного токена → чужие карточки недостижимы (клиент p_actor не называет,
// EXECUTE у клиентских ролей снят в миграции). IDOR закрыт в самом запросе RPC
// (возвращаются только трипы актора: owner ИЛИ active-member).
//
// Возвращает jsonb-массив карточек КАК ЕСТЬ. verify_jwt=true дефолтом
// (аутентификация через getRequestUser, как getMe/getTravelStats/getActiveTrips)
// — записи в config.toml не нужно.

import { withHandler, jsonError } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';

Deno.serve(withHandler('getTrips', async (req, corsHeaders) => {
  // Протухший/отсутствующий токен → 401 (ожидаемо). Реальный сбой Auth-сервиса
  // поднимается 503 внутри getRequestUser (AUTH_UNAVAILABLE) и сюда null не доезжает.
  const user = await getRequestUser(req);
  if (!user) return jsonError(401, 'Unauthorized', 'UNAUTHENTICATED', corsHeaders);

  // `error` здесь = только инфра-сбой БД → throw → 500 INTERNAL (ретраится, летит
  // в Sentry). Бизнес-ответа-«нет» у этого чтения нет: пустой набор — это валидный
  // `[]`, который вернёт сама RPC.
  const { data, error } = await supabaseAdmin.rpc('get_my_trip_cards', { p_actor: user.id });
  if (error) throw error;

  return Response.json(data, { headers: corsHeaders });
}));
