-- TRIP-411 слайс 2 — закрытие КЛИЕНТСКИХ дверей public.users (эпик TRIP-374).
--
-- Слайс 1 (TRIP-411) увёл создание строки users за шов: клиент больше не делает
-- прямой insert().select() — единственная дверь регистрации это edge account/register
-- под service_role (RPC create_user_profile). TRIP-400c ранее снял UPDATE/DELETE.
-- Остаются последние клиентские двери users — INSERT и SELECT у authenticated и
-- SELECT у anon. Снимаем их: users становится service_role-only (клиентских дверей
-- нет), twoDoor users 1→0 — последняя «двойная дверь» эпика закрыта.
--
-- Предусловие проверено read-only на dev ДО миграции:
--   authenticated: INSERT+SELECT (UPDATE/DELETE уже сняты 400c); anon: SELECT;
--   service_role: полный (оставляем). Фронт: ноль прямых .from('users') после
--   слайса 1. Edge читает users ТОЛЬКО под service_role (getMe/getUserPlan/…);
--   два createClient(anon) (signupPrecheck/requestPasswordReset) зовут лишь GoTrue,
--   таблицу не читают. Pro-вердикт кормится subscription_* из getMe (service_role).
--   → REVOKE INSERT+SELECT у authenticated/anon приложение не ломает.

-- 1. Снять клиентские двери: единственный путь к users — шов (service_role).
REVOKE INSERT, SELECT ON public.users FROM authenticated, anon;
-- Defense-in-depth (грабля TRIP-49): дефолтные привилегии могли лечь на PUBLIC,
-- и роль-осведомлённый REVOKE «мимо» PUBLIC выглядит сделанным и не работает.
REVOKE INSERT, SELECT ON public.users FROM public;

-- 2. RLS-политики авторизации мертвы: без гранта PostgREST до строки не доходит, а
--    при RLS on строка без применимой политики = deny. Убираем RLS КАК АВТОРИЗАЦИЮ
--    (Вариант B эпика: в БД остаётся только целостность — FK/CHECK/UNIQUE). RLS
--    оставляем ВКЛЮЧЁННЫМ с нулём политик = deny-all backstop: случайный GRANT в
--    будущем не откроет чтение/запись без явной политики. service_role обходит RLS.
--    (update/delete-политики мертвы с TRIP-400c; insert/select — с этого REVOKE.)
DROP POLICY IF EXISTS users_insert_own ON public.users;
DROP POLICY IF EXISTS users_select_own ON public.users;
DROP POLICY IF EXISTS users_update_own ON public.users;
DROP POLICY IF EXISTS users_delete_own ON public.users;

-- НЕ трогаем: service_role (шов), RLS остаётся enabled (не disable), REFERENCES/
-- TRIGGER/TRUNCATE-гранты (системный дефолт Supabase — зачистка = Ф4/TRIP-396).
