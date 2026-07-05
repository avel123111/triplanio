-- TRIP-120 hardening (гигиена) — два несущих вратаря делаем fail-closed.

-- ── 1) _can_edit_trip: чёрный список → белый ─────────────────────────────────
-- Было: `coalesce(role,'') <> 'viewer'` — «писать может любой, кто НЕ viewer».
-- Риск: будущая строка с role=NULL / новой ролью проваливается в «разрешено»
-- (fail-open). Стало: `role = any('{owner,admin}')` — только явные редакторы; NULL /
-- viewer / неизвестная роль → запись запрещена (fail-closed). Плюс строгий
-- status='active' вместо coalesce (NULL-статус больше не считается активным).
-- Поведение на текущих данных НЕ меняется (роли только viewer/admin; редактор =
-- admin+active; pending/offline и раньше не писали). Это несущий гейт записи ВСЕХ
-- 9 контент-таблиц (ярус A) — ему правильно проваливаться в «запрещено».
create or replace function public._can_edit_trip(p_trip uuid, p_uid uuid)
  returns boolean
  language sql stable security definer
  set search_path to 'public', 'pg_temp'
as $function$
  select exists (select 1 from trips t where t.id = p_trip and t.created_by = p_uid)
      or exists (select 1 from trip_members m
                 where m.trip_id = p_trip and m.user_id = p_uid
                   and m.role = any (array['owner','admin'])
                   and m.status = 'active');
$function$;

-- ── 2) _can_access_trip_file: закрыть утечку приватных ФАЙЛОВ ─────────────────
-- Было SECURITY INVOKER: его защитный NOT EXISTS-подзапрос читал trip_documents ПОД
-- RLS вызывающего. А RLS trip_documents прячет ЧУЖОЙ private-док от со-участника →
-- подзапрос его «не видел» → NOT EXISTS=true → правило считало файл не-приватным →
-- со-участник МОГ скачать/перечислить чужой приватный документ через Storage API
-- (list('<tripId>/') + createSignedUrl). Тот же класс, что строку закрыл TRIP-118,
-- но на слое файлов, из-за INVOKER-«слепоты».
-- Фикс: SECURITY DEFINER — подзапрос видит ВСЕ строки trip_documents (в обход RLS) →
-- корректно ловит «чужой private» → отказ. auth.uid() в definer читается из JWT как
-- обычно. Легитимный доступ сохраняется: свой private (created_by=self не матчит),
-- shared-доки (visibility<>'private' не матчит), вложения броней/сервисов/обложки
-- (в trip_documents строки нет → NOT EXISTS true → по участию). + search_path pg_temp.
create or replace function public._can_access_trip_file(p_object_name text)
  returns boolean
  language sql stable security definer
  set search_path to 'public', 'pg_temp'
as $function$
  select case
    when (storage.foldername(p_object_name))[1]
         ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then
      public.is_trip_participant(((storage.foldername(p_object_name))[1])::uuid)
      and not exists (
        select 1
        from public.trip_documents d
        cross join lateral jsonb_array_elements(coalesce(d.documents, '[]'::jsonb)) e
        where e->>'storage_path' = p_object_name
          and d.trip_id = ((storage.foldername(p_object_name))[1])::uuid
          and d.visibility = 'private'
          and d.created_by is distinct from auth.uid()
      )
    else false
  end;
$function$;
