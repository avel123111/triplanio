/**
 * getMe — ярус A эпика «единая дверь в данные» (TRIP-400, домен аккаунта).
 *
 * Читает СВОЮ строку `public.users` под `service_role` по актору из JWT. Заменяет
 * прямой `from('users').select('*')` бутстрапа `AuthContext` — фронт перестаёт
 * ходить в БД за профилем.
 *
 * ★ ВОЗВРАЩАЕТ ПОЛНУЮ СТРОКУ той же формы, что снимал прямой select (id, email,
 * full_name, avatar_url, language, unit_system, deleted_at, campaign-колонки И
 * ПЛАТЁЖНЫЕ subscription_status/subscription_end_date). Ни одно поле не дропаем:
 * клиентский Pro-вердикт `isProActive(user)` считается из кэша
 * `subscription_status`/`_end_date` — без них Pro-гейт остался бы без источника.
 * Чтение платёжных колонок здесь — не запись: их пишет только webhook Stripe.
 *
 * ★★ «Строки ещё нет» — это 200 `{ user: null }`, а не отказ. Запрос УСПЕШЕН,
 * значение — «профиль не создан» (как getUserPlan → `{ plan:'free' }`). На первом
 * логине `AuthContext` по `null` запускает свою ветку создания профиля (домен
 * регистрации — последний, здесь не трогаем). Мимо honest-refusal и без шума в
 * Sentry: 404 на ожидаемое состояние был бы ложным инцидентом.
 *
 * verify_jwt=true дефолтом (функция аутентифицируется через getRequestUser, как
 * getUserPlan) — записи в config.toml не нужно.
 */

import { withHandler } from '../_shared/http.ts';
import { supabaseAdmin, requireUser } from '../_shared/supabaseAdmin.ts';

Deno.serve(withHandler('getMe', async (req, corsHeaders) => {
  const user = await requireUser(req);

  // `maybeSingle`: 0 строк — не ошибка, а `data: null` (см. ★★). `error` здесь =
  // только инфра-сбой → throw → 500 INTERNAL (ретраится, летит в Sentry).
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw error;

  return Response.json({ user: data ?? null }, { headers: corsHeaders });
}));
