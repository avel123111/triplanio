-- TRIP-214 follow-up — `search_gazetteer_core` должна быть INTERNAL, но осталась
-- client-исполнимой → пост-деплойный security-tiers ассерт упал (IF3).
--
-- Предыдущая миграция (20260709103000) сняла с ядра только `PUBLIC` EXECUTE.
-- В Supabase на новые функции в `public` через ALTER DEFAULT PRIVILEGES вешаются
-- ЯВНЫЕ EXECUTE-гранты ролям `anon`/`authenticated` (не через PUBLIC), поэтому
-- `revoke ... from public` их не тронул — ядро осталось исполнимым anon+auth
-- (проверено: has_function_privilege('anon'|'authenticated', …)=true). Это
-- зеркало урока TRIP-49 (там наоборот — грант висел на PUBLIC, ревок шёл FROM anon).
--
-- Ядро зовётся только из SECURITY DEFINER-обёрток (search_gazetteer /
-- search_gazetteer_batch), которые исполняются под владельцем и EXECUTE на ядре
-- им гарантирован владением — снятие клиентских грантов их не ломает.
revoke execute on function public.search_gazetteer_core(text, text, int)
  from anon, authenticated, public;
