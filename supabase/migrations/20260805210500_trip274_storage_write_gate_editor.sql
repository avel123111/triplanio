-- TRIP-274 Ф1.1 — байты бакета `trips` переводим на ступень `editor`.
--
-- Дверь 4 (storage.objects) была единственной, где право ЗАПИСИ выводилось из
-- предиката ЧТЕНИЯ: все четыре команды бакета `trips` стояли на одном
-- `_can_access_trip_file` (20260731172548_trip281_upload_format_limits.sql:192-213),
-- а он внутри проверяет `is_trip_participant`. Итог: viewer клал байты в папку
-- трипа прямым вызовом Storage API. Строка в `trip_documents` при этом
-- отклонялась (её политики уже на `_can_edit_trip`, TRIP-124), поэтому файл
-- оставался в бакете сиротой — видимого следа в UI нет, уборки нет.
--
-- ПОЧЕМУ НЕ ПРОСТОЙ СВАП `is_trip_participant` → `_can_edit_trip` ВНУТРИ
-- `_can_access_trip_file`: эта функция делает ДВЕ вещи разом —
--   (1) участ-скоупный доступ к файлу трипа;
--   (2) защиту ЧУЖОГО приватного документа (TRIP-118/TRIP-120).
-- Подмена предиката целиком снесла бы (2) для тех, кто проходит (1) по новой
-- ступени, то есть админ смог бы затереть ФАЙЛ чужого приватного документа,
-- хотя СТРОКУ ему запрещает `trip_documents_update/delete`
-- (20260705150000_trip124_viewer_write_rls_split.sql:63-91). Это ровно тот баг,
-- что чинил TRIP-118, с другой стороны. Приватный документ переживает понижение
-- роли: строку вставил админ, потом его понизили — `created_by` остался за ним.
--
-- Поэтому правило раскладывается на слагаемые, и из них собираются ДВА гейта:
--   read  = is_trip_participant ∧ ¬(чужой private)   ← без изменений
--   write = _can_edit_trip      ∧ ¬(чужой private)   ← новое
-- Общая половина ¬(чужой private) живёт в ОДНОМ месте, а не в двух копиях.
--
-- Ветка `_drafts/<uid>/` (черновая обложка, TRIP-281) НЕ трогается: она
-- пер-юзерная и к роли в трипе отношения не имеет — черновик заливают ДО того,
-- как трип существует. Поэтому DoD этой фазы звучит «viewer не кладёт байты в
-- папку `<tripId>/`», а не «в бакет»: `_drafts/<uid>/` остаётся доступен любому
-- залогиненному, как и был.

-- ── 1) trip_id из ключа объекта, или NULL если ключ не про трип ───────────────
-- Вынесено, чтобы UUID-регексп и приведение типа существовали в одном
-- экземпляре на оба гейта. Internal: зовётся только из definer-функций ниже,
-- клиенту не гранитится.
create or replace function public._trip_file_trip_id(p_object_name text)
  returns uuid
  language sql stable
  set search_path to 'public', 'pg_temp'
as $function$
  select case
    when (storage.foldername(p_object_name))[1]
         ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then ((storage.foldername(p_object_name))[1])::uuid
  end;
$function$;

-- ── 2) «Это НЕ чужой приватный документ» ─────────────────────────────────────
-- Половина, общая для чтения и записи. SECURITY DEFINER обязателен и здесь:
-- под RLS вызывающего подзапрос не видит чужой private-документ → NOT EXISTS
-- истинно → правило считает файл не-приватным и пускает. Это и была слепота,
-- которую чинил TRIP-120; вынося подзапрос, её нельзя потерять по дороге.
create or replace function public._trip_file_not_others_private(p_trip uuid, p_object_name text)
  returns boolean
  language sql stable security definer
  set search_path to 'public', 'pg_temp'
as $function$
  select not exists (
    select 1
    from public.trip_documents d
    cross join lateral jsonb_array_elements(coalesce(d.documents, '[]'::jsonb)) e
    where e->>'storage_path' = p_object_name
      and d.trip_id = p_trip
      and d.visibility = 'private'
      and d.created_by is distinct from auth.uid()
  );
$function$;

-- ── 3) ЧТЕНИЕ — поведение не меняется ────────────────────────────────────────
-- Тот же предикат, что и до миграции, собранный из слагаемых 1+2. Пересоздаётся
-- только ради того, чтобы обе половины правила были видны в одном месте.
create or replace function public._can_access_trip_file(p_object_name text)
  returns boolean
  language sql stable security definer
  set search_path to 'public', 'pg_temp'
as $function$
  select case
    when t.tid is null then false
    else public.is_trip_participant(t.tid)
     and public._trip_file_not_others_private(t.tid, p_object_name)
  end
  from (select public._trip_file_trip_id(p_object_name) as tid) t;
$function$;

-- ── 4) ЗАПИСЬ — ступень editor ───────────────────────────────────────────────
-- `_can_edit_trip` = владелец трипа ИЛИ активный admin/owner (белый список,
-- TRIP-120). Вторая половина та же, поэтому админ по-прежнему не трогает файл
-- чужого приватного документа — гейт файла и гейт строки говорят одно и то же.
create or replace function public._can_write_trip_file(p_object_name text)
  returns boolean
  language sql stable security definer
  set search_path to 'public', 'pg_temp'
as $function$
  select case
    when t.tid is null then false
    else public._can_edit_trip(t.tid, auth.uid())
     and public._trip_file_not_others_private(t.tid, p_object_name)
  end
  from (select public._trip_file_trip_id(p_object_name) as tid) t;
$function$;

-- ── Гранты ───────────────────────────────────────────────────────────────────
-- Слагаемые 1 и 2 — internal (инвариант IF3 стража ярусов: secdef-функция вне
-- манифеста не должна быть client-исполнимой). REVOKE идёт FROM PUBLIC, а не
-- FROM anon: дефолтный EXECUTE висит именно на PUBLIC, и ревок с роли его не
-- снимает — грабля TRIP-49.
-- Владелец у SECURITY DEFINER — то, чьими правами функция исполняется; для новых
-- функций фиксируем явно, как это делает TRIP-118, а не полагаемся на роль,
-- которой шёл `db push`.
alter function public._trip_file_not_others_private(uuid, text) owner to postgres;
alter function public._can_write_trip_file(text) owner to postgres;

revoke all on function public._trip_file_trip_id(text) from public, anon, authenticated;
revoke all on function public._trip_file_not_others_private(uuid, text) from public, anon, authenticated;
grant execute on function public._trip_file_trip_id(text) to service_role;
grant execute on function public._trip_file_not_others_private(uuid, text) to service_role;

-- Гейты исполняются из storage-политик `TO public`, поэтому нужны обеим ролям —
-- зеркалим грант, который уже есть у `_can_access_trip_file` (TRIP-118).
-- Для anon оба вернут false (`auth.uid()` пуст), но должны вернуть, а не упасть
-- с «permission denied for function» посреди вычисления политики.
grant execute on function public._can_write_trip_file(text) to anon, authenticated, service_role;

-- ── Политики бакета `trips` ──────────────────────────────────────────────────
-- SELECT остаётся на read-предикате, INSERT/UPDATE/DELETE переезжают на write.
-- Форма блока — та же, что в TRIP-281 (общий текст предиката в переменной), но
-- предиката теперь два.
DO $$
DECLARE
  -- Свой черновик: `_drafts/<uid>/<файл>` — пер-юзерная ветка, вне ролей трипа.
  own_draft text := $pred$
    (("storage"."foldername"("name"))[1] = '_drafts'
     AND ("storage"."foldername"("name"))[2] = "auth"."uid"()::text)
  $pred$;
  read_pred text;
  write_pred text;
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE NOTICE 'storage.objects not present — skipping trips bucket policies';
    RETURN;
  END IF;

  read_pred  := own_draft || $pred$ OR "public"."_can_access_trip_file"("name") $pred$;
  write_pred := own_draft || $pred$ OR "public"."_can_write_trip_file"("name") $pred$;

  EXECUTE format($f$
    DROP POLICY IF EXISTS "trips_select" ON "storage"."objects";
    CREATE POLICY "trips_select" ON "storage"."objects"
      FOR SELECT TO "public"
      USING ("bucket_id" = 'trips' AND (%1$s));

    DROP POLICY IF EXISTS "trips_insert" ON "storage"."objects";
    CREATE POLICY "trips_insert" ON "storage"."objects"
      FOR INSERT TO "public"
      WITH CHECK ("bucket_id" = 'trips' AND (%2$s));

    DROP POLICY IF EXISTS "trips_update" ON "storage"."objects";
    CREATE POLICY "trips_update" ON "storage"."objects"
      FOR UPDATE TO "public"
      USING ("bucket_id" = 'trips' AND (%2$s))
      WITH CHECK ("bucket_id" = 'trips' AND (%2$s));

    DROP POLICY IF EXISTS "trips_delete" ON "storage"."objects";
    CREATE POLICY "trips_delete" ON "storage"."objects"
      FOR DELETE TO "public"
      USING ("bucket_id" = 'trips' AND (%2$s));
  $f$, read_pred, write_pred);
END $$;
