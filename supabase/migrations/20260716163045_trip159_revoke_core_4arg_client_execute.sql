-- TRIP-159 follow-up — снять клиентский EXECUTE с НОВОЙ 4-арг сигнатуры
-- search_gazetteer_core (той же граблей, что TRIP-214, повторно).
--
-- Миграция 20260716161512 пересоздала ядро с 4-м параметром `cc` и сняла с него
-- только `PUBLIC` EXECUTE. Но в Supabase на новые функции в `public` через
-- ALTER DEFAULT PRIVILEGES вешаются ЯВНЫЕ EXECUTE-гранты ролям anon/authenticated
-- (не через PUBLIC), поэтому `revoke ... from public` их не тронул — ядро осталось
-- client-исполнимым → пост-деплойный security-tiers ассерт упал (IF3):
-- «secdef search_gazetteer_core client-исполнима, но не в манифесте».
--
-- Ядро зовётся только из SECURITY DEFINER-обёрток (search_gazetteer /
-- search_gazetteer_batch), исполняемых под владельцем — EXECUTE им гарантирован
-- владением, снятие клиентских грантов их не ломает. Полное зеркало
-- 20260709121207 (trip214), но для 4-арг сигнатуры.
revoke execute on function public.search_gazetteer_core(text, text, integer, text)
  from anon, authenticated, public;
