// getInbox — ридер инбокса, ярус B эпика «единая дверь в данные» (TRIP-408).
//
// Композит инбокса: отдаёт `{ list, unreadCount }` одним вызовом обоим
// потребителям (колокол в AppHeader + страница /inbox). Заменяет прямое чтение
// `notifications` с клиента И водопад чтений `trip_members` по invite-строкам:
// `list` обогащён `member_status` (join в RPC), `unreadCount` — честный COUNT
// (не «сколько влезло в список»). Читается seam-ом `src/lib/useNotifications.js`.
//
// ★ Актор — из JWT, не из тела. RPC `get_inbox` принимает явный `p_actor`: под
// service_role её `auth.uid()` был бы NULL. `p_actor` берём ТОЛЬКО из
// проверенного токена → чужой инбокс недостижим (клиент актора не называет,
// EXECUTE у клиентских ролей снят в миграции; таблица `notifications` закрыта).
//
// verify_jwt=true дефолтом (аутентификация через getRequestUser, как getTrips) —
// записи в config.toml не нужно.

import { withHandler, jsonError } from '../_shared/http.ts';
import { supabaseAdmin, getRequestUser } from '../_shared/supabaseAdmin.ts';

Deno.serve(withHandler('getInbox', async (req, corsHeaders) => {
  // Протухший/отсутствующий токен → 401 (ожидаемо). Реальный сбой Auth-сервиса
  // поднимается 503 внутри getRequestUser (AUTH_UNAVAILABLE) и сюда null не доезжает.
  const user = await getRequestUser(req);
  if (!user) return jsonError(401, 'Unauthorized', 'UNAUTHENTICATED', corsHeaders);

  // `error` = только инфра-сбой БД → throw → 500 INTERNAL. Бизнес-ответа-«нет» у
  // чтения нет: пустой инбокс — валидный `{ list: [], unreadCount: 0 }` от RPC.
  const { data, error } = await supabaseAdmin.rpc('get_inbox', { p_actor: user.id });
  if (error) throw error;

  return Response.json(data, { headers: corsHeaders });
}));
