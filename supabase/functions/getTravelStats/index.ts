// getTravelStats — ярус A эпика «единая дверь в данные» (TRIP-402, домен статистики).
//
// ОБЩИЙ ридер: его читают ДВА экрана — «Моя статистика» (Statistics.jsx) и
// главная с обложками трипов (Trips.jsx). Оба уходят сюда в одном PR и делят один
// кэш react-query (`['travel-stats', user.id]`) — кто первый загрузил, второй
// переиспользует. Заменяет прямой `supabase.rpc('get_user_travel_stats')` фронта.
//
// ★ Актор — из JWT, не из тела. RPC теперь принимает явный p_actor (миграция
// 20260811174038): под service_role её внутренний auth.uid() был бы NULL. p_actor
// берём ТОЛЬКО из проверенного токена, поэтому чужие статы недостижимы (клиент
// p_actor не называет). EXECUTE у authenticated/anon снят той же миграцией —
// прямого клиентского пути к RPC нет.
//
// Возвращает jsonb RPC КАК ЕСТЬ (points/trips/transfers/transfers_total/
// trip_visits) — форма 1:1 с тем, что снимал прямой .rpc(), клиент не меняет
// чтение полей. verify_jwt=true дефолтом (аутентификация через getRequestUser,
// как getMe/getActiveTrips) — записи в config.toml не нужно.

import { withHandler, jsonError } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';

Deno.serve(withHandler('getTravelStats', async (req, corsHeaders) => {
  // Протухший/отсутствующий токен → 401 (ожидаемо). Реальный сбой Auth-сервиса
  // поднимается 503 внутри getRequestUser (AUTH_UNAVAILABLE) и сюда null не доезжает.
  const user = await getRequestUser(req);
  if (!user) return jsonError(401, 'Unauthorized', 'UNAUTHENTICATED', corsHeaders);

  // `error` здесь = только инфра-сбой БД → throw → 500 INTERNAL (ретраится, летит
  // в Sentry). Бизнес-ответа-«нет» у этого чтения нет: пустой набор — это валидный
  // `{ points:[], trips:{}, ... }`, который вернёт сама RPC.
  const { data, error } = await supabaseAdmin.rpc('get_user_travel_stats', { p_actor: user.id });
  if (error) throw error;

  return Response.json(data, { headers: corsHeaders });
}));
