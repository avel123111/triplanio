-- TRIP-296 (фикс): EXECUTE у новых функций отзывается у ролей ЯВНО, не у PUBLIC.
--
-- Пост-деплой страж ярусов (LIVE) уронил накатывание: send_chat_message оказалась
-- исполнимой anon, а claim_ai_run / finish_ai_run — client-исполнимыми, хотя
-- предыдущая миграция делала `revoke execute ... from public`.
--
-- Причина (проверено на живой dev): в проекте настроены DEFAULT PRIVILEGES —
--   alter default privileges in schema public grant execute on functions
--     to anon, authenticated, service_role
-- (pg_default_acl держит их и от postgres, и от supabase_admin). Поэтому у КАЖДОЙ
-- новой функции в public сразу стоят ЯВНЫЕ гранты ролям:
--   proacl = {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
-- Отзыв у PUBLIC такой грант не трогает — PUBLIC тут вообще ни при чём.
--
-- Это зеркало граблей TRIP-49, где всё было наоборот: там право держал PUBLIC, и
-- бесполезен был точечный `revoke ... from anon`. Отсюда правило для новых
-- функций: отзывать всегда у `public, anon, authenticated` (и у service_role,
-- если функция не для edge), а нужное — возвращать явным грантом.

-- Клиентская функция: остаётся только authenticated.
revoke execute on function public.send_chat_message(uuid, text, uuid) from public, anon;
grant  execute on function public.send_chat_message(uuid, text, uuid) to authenticated;

-- Прогоном ассистента управляет только сервер (edge под service_role).
revoke execute on function public.claim_ai_run(uuid)                    from public, anon, authenticated;
revoke execute on function public.finish_ai_run(uuid, uuid, text, text) from public, anon, authenticated;
grant  execute on function public.claim_ai_run(uuid)                    to service_role;
grant  execute on function public.finish_ai_run(uuid, uuid, text, text) to service_role;

-- Предикат зовётся только изнутри send_chat_message. Она SECURITY DEFINER, то
-- есть исполняется от владельца (postgres), у которого EXECUTE остаётся, —
-- отзыв у клиентских ролей её не ломает.
revoke execute on function public.mentions_assistant(text) from public, anon, authenticated;

-- Сторож запускается pg_cron от владельца задания (postgres). Ни клиенту, ни
-- edge он не нужен.
revoke execute on function public.chat_ai_run_watchdog() from public, anon, authenticated, service_role;
