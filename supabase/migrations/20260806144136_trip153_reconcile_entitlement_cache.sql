-- TRIP-153 (3/4): Сверка А — кэш против реестра. Чистый SQL, ноль вызовов наружу.
--
-- Право живёт в двух местах: реестр (subscription, purchase) и кэш
-- (users.subscription_*, trips.is_pro_trip). Приложение читает кэш. Ленивая
-- сверка при чтении не запускается у того, чей кэш врёт В НАШУ ПОЛЬЗУ
-- (needsEntitlementReconcile возвращает false при status='pro' и будущей дате),
-- и не запускается вовсе у того, кто не заходит. Эта сверка проходит всех.
--
-- ЧТО ОНА НЕ ДЕЛАЕТ: не вычисляет право сама. Она зовёт ТЕ ЖЕ процедуры
-- (recompute_user_entitlement, recompute_trip_entitlement, revoke_user_pro_addons)
-- и смотрит, что они изменили. Разница «до/после» — одновременно и починка, и
-- метрика. Ни одной переписанной формулы: у recompute_user_entitlement три
-- входа, включая грейс past_due по provider_meta (TRIP-158), и копия по
-- описанию рапортовала бы каждого дённинг-юзера как расхождение ежечасно.
--
-- Проход ПОЛНЫЙ, без выборки кандидатов: выборка — это предикат, а промах
-- предиката не краснеет, он молча не проверяет. Честно до десятков тысяч
-- юзеров (сейчас 38); сузим, когда метрика покажет, что предикат ничего не
-- теряет, — не раньше.
--
-- Режим report откатывает СВОИ записи через подтранзакцию и оставляет только
-- находки: первое, что новый механизм делает в проде, не должно быть массовым
-- изменением прав. Расписание вводится в режиме report НАМЕРЕННО — перевод на
-- apply отдельной миграцией, после того как Pavel посмотрит журнал.

create extension if not exists pg_cron;

create or replace function public.reconcile_entitlement_cache(p_mode text default 'report')
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_run            uuid;
  v_user           record;
  v_trip           record;
  v_revoked        record;
  v_before_status  text;
  v_before_end     timestamptz;
  v_after_status   text;
  v_after_end      timestamptz;
  v_before_pro     boolean;
  v_after_pro      boolean;
  v_addons_before  jsonb;
  v_addons_after   jsonb;
  v_addon_hits     jsonb;
  v_hit            jsonb;
  v_err            text;
  v_scanned_users  integer := 0;
  v_scanned_trips  integer := 0;
  v_found          integer := 0;
  v_fixed          integer := 0;
  v_unfixable      integer := 0;
  v_action         text;
begin
  if p_mode not in ('report', 'apply') then
    raise exception 'reconcile_entitlement_cache: unknown mode %', p_mode;
  end if;
  v_action := case when p_mode = 'apply' then 'fixed' else 'reported' end;

  insert into reconcile_run (kind, mode, status)
       values ('cache', p_mode, 'running')
    returning id into v_run;

  -- Ретеншн 30 дней. Чистим В НАЧАЛЕ своего же прогона, а не отдельной джобой:
  -- одна движущаяся часть вместо двух, и чистка не может «отстать» от писателя.
  -- Находки уезжают каскадом по run_id.
  delete from reconcile_run r
   where r.started_at < now() - interval '30 days';

  -- ==========================================================================
  -- 1. Юзеры: кэш подписки + откат аддонов
  -- ==========================================================================
  for v_user in select id, subscription_status, subscription_end_date from users loop
    v_scanned_users := v_scanned_users + 1;
    v_before_status := v_user.subscription_status;
    v_before_end    := v_user.subscription_end_date;
    v_err           := null;
    v_addon_hits    := '[]'::jsonb;
    -- Сбрасываем «стало» явно. Читается оно только на пути v_err is null, но это
    -- держится на одном `continue` ниже: стоит его тронуть — и в находку уедет
    -- значение от ПРЕДЫДУЩЕГО юзера. Одна строка убирает целый класс ошибки.
    v_after_status  := null;
    v_after_end     := null;

    select coalesce(jsonb_object_agg(t.id::text, coalesce(t.details->'addons', '{}'::jsonb)), '{}'::jsonb)
      into v_addons_before
      from trips t
     where t.created_by = v_user.id;

    -- Подтранзакция на юзера. Два назначения сразу:
    --   • report — откатывает запись, но НЕ переменные plpgsql (они переживают
    --     откат), поэтому «стало» остаётся посчитанным ТЕМ ЖЕ кодом, что и в
    --     apply. Именно это позволяет не держать второй формулы;
    --   • apply — сбой на одном юзере не роняет весь прогон, он становится
    --     находкой action='failed' (иначе один битый ряд лишал бы сверки всех).
    -- Цена — подтранзакция на строку. Считать её надо НЕ в XID, а в ПОРОГЕ 64:
    -- столько subxid кэшируется в PGPROC, дальше снимок помечается suboverflowed и
    -- ВСЕ остальные бэкенды начинают ходить в pg_subtrans на каждой проверке
    -- видимости. 38 юзеров + 50 трипов = 88 подтранзакций, порог уже перейдён.
    -- Спасает миграция «elide»: подтранзакция БЕЗ записи не получает XID и в кэш не
    -- попадает, поэтому в установившемся режиме почти все они пустые, и кусается
    -- это только на первом apply-прогоне и при массовом дрейфе.
    begin
      perform recompute_user_entitlement(v_user.id);

      select subscription_status, subscription_end_date
        into v_after_status, v_after_end
        from users where id = v_user.id;

      -- Аддоны. revoke_user_pro_addons самогейтится на NOT is_trip_pro, но
      -- возвращает трипы, ПОДОШЕДШИЕ под WHERE, а не те, где что-то реально
      -- изменилось: четвёртая ветка OR в её условии смотрит на живую привязку
      -- Telegram, которую сам UPDATE не трогает. Поэтому «погашено» считаем
      -- сравнением флагов до/после — иначе трип с живой привязкой возвращался
      -- бы вечно и находка горела бы каждый час на уже починенном.
      for v_revoked in select trip_id from revoke_user_pro_addons(v_user.id) loop
        select coalesce(t.details->'addons', '{}'::jsonb)
          into v_addons_after
          from trips t where t.id = v_revoked.trip_id;

        if (v_addons_before -> v_revoked.trip_id::text) is distinct from v_addons_after then
          v_addon_hits := v_addon_hits || jsonb_build_array(jsonb_build_object(
            'trip_id', v_revoked.trip_id,
            'before',  v_addons_before -> v_revoked.trip_id::text,
            'after',   v_addons_after));
        end if;
      end loop;

      if p_mode = 'report' then
        -- Свой SQLSTATE, а не опознание по ТЕКСТУ: голый `raise exception` даёт
        -- P0001 — тот же код, что у любого прикладного raise внутри вызываемых
        -- функций, и совпадение по тексту сообщения ничем не запрещено.
        raise exception 'reconcile_probe' using errcode = 'ZZ001';
      end if;
    exception
      when sqlstate 'ZZ001' then null;   -- ожидаемый откат report-режима
      -- SQLSTATE сохраняем в находке: иначе 23514 от 40P01 придётся отличать по строке.
      when others then v_err := sqlstate || ': ' || sqlerrm;
    end;

    if v_err is not null then
      insert into reconcile_finding (run_id, kind, subject_type, subject_id, action, error)
           values (v_run, 'cache_drift_user', 'user', v_user.id::text, 'failed', v_err);
      continue;
    end if;

    if (v_before_status, v_before_end) is distinct from (v_after_status, v_after_end) then
      insert into reconcile_finding (run_id, kind, subject_type, subject_id, before, after, action)
           values (v_run, 'cache_drift_user', 'user', v_user.id::text,
                   jsonb_build_object('status', v_before_status, 'end_date', v_before_end),
                   jsonb_build_object('status', v_after_status,  'end_date', v_after_end),
                   v_action);
    end if;

    for v_hit in select jsonb_array_elements(v_addon_hits) loop
      insert into reconcile_finding (run_id, kind, subject_type, subject_id, before, after, action)
           values (v_run, 'addons_revoked', 'trip', v_hit->>'trip_id',
                   v_hit->'before', v_hit->'after', v_action);
    end loop;
  end loop;

  -- ==========================================================================
  -- 2. Трипы: кэш разовой Trip Pro
  -- ==========================================================================
  -- Закрывает наполовину записанную покупку: строка purchase вставлена, а
  -- recompute упал — вебхук на ретрае выходит рано по provider_ref и до
  -- recompute больше не доходит, поэтому is_pro_trip остаётся false навсегда.
  -- Здесь он чинится в течение часа, не трогая вебхук.
  for v_trip in select id, is_pro_trip from trips loop
    v_scanned_trips := v_scanned_trips + 1;
    v_before_pro := v_trip.is_pro_trip;
    v_err        := null;
    v_after_pro  := null;   -- см. тот же довод в цикле по юзерам

    begin
      perform recompute_trip_entitlement(v_trip.id);
      select is_pro_trip into v_after_pro from trips where id = v_trip.id;
      if p_mode = 'report' then
        -- Свой SQLSTATE, а не опознание по ТЕКСТУ: голый `raise exception` даёт
        -- P0001 — тот же код, что у любого прикладного raise внутри вызываемых
        -- функций, и совпадение по тексту сообщения ничем не запрещено.
        raise exception 'reconcile_probe' using errcode = 'ZZ001';
      end if;
    exception
      when sqlstate 'ZZ001' then null;   -- ожидаемый откат report-режима
      -- SQLSTATE сохраняем в находке: иначе 23514 от 40P01 придётся отличать по строке.
      when others then v_err := sqlstate || ': ' || sqlerrm;
    end;

    if v_err is not null then
      insert into reconcile_finding (run_id, kind, subject_type, subject_id, action, error)
           values (v_run, 'cache_drift_trip', 'trip', v_trip.id::text, 'failed', v_err);
      continue;
    end if;

    if v_before_pro is distinct from v_after_pro then
      insert into reconcile_finding (run_id, kind, subject_type, subject_id, before, after, action)
           values (v_run, 'cache_drift_trip', 'trip', v_trip.id::text,
                   jsonb_build_object('is_pro_trip', v_before_pro),
                   jsonb_build_object('is_pro_trip', v_after_pro),
                   v_action);
    end if;
  end loop;

  -- ==========================================================================
  -- 3. Только считаем, не чиним
  -- ==========================================================================
  -- Живая привязка Telegram на не-Pro трипе. СТОЯЧЕЕ состояние, а не побочка
  -- вызова revoke_*: иначе оно попадало бы в журнал ровно один раз (в час, когда
  -- флаги реально флипнулись) и дальше молчало, пока привязка жива. А жива она
  -- останется до PR2, где DELETE уезжает внутрь revoke_*_pro_addons — до тех пор
  -- гасятся только флаги. Это тот случай, где aiGate НЕ проверяет Pro сам и
  -- держится на инварианте «есть привязка ⇒ трип Pro», то есть сломанный
  -- инвариант = бесплатный ИИ через бота. После PR2 класс терминируется сам.
  insert into reconcile_finding (run_id, kind, subject_type, subject_id, source, action)
  select v_run, 'tg_binding_on_non_pro_trip', 'trip', t.id::text,
         jsonb_build_object('bindings', count(i.id), 'owner', t.created_by),
         'reported'
    from trips t
    join trip_telegram_integrations i on i.trip_id = t.id
   where not is_trip_pro(t.id)
   group by t.id, t.created_by;

  -- Покупка без трипа: трип удалён (FK ON DELETE SET NULL), деньги приняты,
  -- начислять некуда. Чинить нечем — только видеть.
  insert into reconcile_finding (run_id, kind, subject_type, subject_id, source, action)
  select v_run, 'orphan_purchase', 'purchase', p.id::text,
         jsonb_build_object('user_id', p.user_id, 'product_code', p.product_code,
                            'purchased_at', p.purchased_at),
         'reported'
    from purchase p
   where p.status = 'active' and p.trip_id is null;

  insert into reconcile_finding (run_id, kind, subject_type, subject_id, source, action)
  select v_run, 'needs_review', 'subscription', s.id::text,
         jsonb_build_object('user_id', s.user_id, 'status', s.status), 'reported'
    from subscription s where s.needs_review
  union all
  select v_run, 'needs_review', 'purchase', p.id::text,
         jsonb_build_object('user_id', p.user_id, 'status', p.status), 'reported'
    from purchase p where p.needs_review;

  -- Больше одной живой подписки у юзера. uq_subscription_user_live этого не
  -- допускает, поэтому находка здесь означает, что индекс обошли, — разбирать
  -- руками (TRIP-152).
  insert into reconcile_finding (run_id, kind, subject_type, subject_id, source, action)
  select v_run, 'multi_live_sub', 'user', s.user_id::text,
         jsonb_build_object('live', count(*)), 'reported'
    from subscription s
   where s.status in ('active', 'trialing', 'past_due')
   group by s.user_id
  having count(*) > 1;

  -- Итоги считаем ПО ЖУРНАЛУ, а не встречными счётчиками в ветках: журнал —
  -- единственный источник (счётчик в ветке разъезжается с ним молча, стоит
  -- добавить ветку и забыть инкремент).
  --
  -- ⚠️report НЕ предсказывает apply один в один, и обещать этого нельзя. Секции 1-2
  -- совпадают (их «стало» посчитано тем же кодом), а вот секция 3 читает КЭШ
  -- (`is_trip_pro`), правки которого в report-режиме откачены подтранзакциями.
  -- Поэтому трип, у которого в apply флаг флипнулся бы в true, в report всё равно
  -- попадёт в tg_binding_on_non_pro_trip. Держать это в голове при разборе первого
  -- прод-прогона: в report класс завышен, а не занижен.
  select count(*),
         count(*) filter (where action = 'fixed'),
         count(*) filter (where action in ('reported', 'failed'))
    into v_found, v_fixed, v_unfixable
    from reconcile_finding where run_id = v_run;

  -- 'partial' = прогон дошёл до конца, но часть субъектов упала. Раньше тут стояло
  -- жёсткое 'ok': прогон, где упали ВСЕ юзеры, рапортовал бы успех, объявленные в
  -- CHECK 'partial'/'failed' не писались никогда, а вью reconcile_open_findings
  -- фильтровала по мёртвому значению.
  update reconcile_run
     set finished_at = now(),
         status = case when exists (
                    select 1 from reconcile_finding f
                     where f.run_id = v_run and f.action = 'failed'
                  ) then 'partial' else 'ok' end,
         scanned_users = v_scanned_users, scanned_trips = v_scanned_trips,
         found = v_found, fixed = v_fixed, unfixable = v_unfixable
   where id = v_run;

  -- ==========================================================================
  -- 4. Алерт в Sentry
  -- ==========================================================================
  -- Тот же ingest-DSN, что у tg_reminders_undelivered_watchdog. `environment`
  -- зашит 'production' — РЕШЕНИЕ Pavel: из SQL окружение всё равно не выводится
  -- (обе базы называются postgres), разбирать всё равно руками, а молчащая
  -- сверка бесполезна. Следствие принято: находки с dev тоже приедут с меткой
  -- production.
  --
  -- Уровень error по всем находкам — решение Pavel «на старте ничего не глушим».
  --
  -- ⚠️Сообщение БЕЗ идентификаторов и БЕЗ счётчиков: и то и другое меняется от
  -- прогона к прогону, а Sentry группирует по тексту — иначе каждый час рождался
  -- бы новый issue. Числа и run_id уходят в extra, группировка пинится явным
  -- fingerprint (мы постим в ingest сырым POST, без SDK, который сгруппировал бы
  -- сам — ровно поэтому у SQL-сторожей fingerprint есть, а у reportPaymentAnomaly
  -- в edge его нет).
  if v_found > 0 then
    raise warning 'reconcile_entitlement_cache(%): % finding(s), run %', p_mode, v_found, v_run;

    perform net.http_post(
      url := 'https://o4511457186283520.ingest.de.sentry.io/api/4511498293870672/store/?sentry_key=9c578daf4586c7383f902d365a22b983&sentry_version=7',
      body := jsonb_build_object(
        'platform', 'other',
        'level', 'error',
        'logger', 'pg_cron',
        'environment', 'production',
        'message', 'Entitlement reconcile: drift found',
        'tags', jsonb_build_object(
          'surface', 'supabase', 'check', 'entitlement_reconcile', 'mode', p_mode),
        'fingerprint', jsonb_build_array('supabase', 'entitlement-reconcile', 'drift'),
        'extra', jsonb_build_object(
          'run_id', v_run, 'mode', p_mode,
          'found', v_found, 'fixed', v_fixed, 'unfixable', v_unfixable,
          'scanned_users', v_scanned_users, 'scanned_trips', v_scanned_trips,
          'by_kind', (select jsonb_object_agg(k, n) from (
                        select kind as k, count(*) as n
                          from reconcile_finding where run_id = v_run
                         group by kind) x))
      ),
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  end if;

  return v_run;
end;
$$;

comment on function public.reconcile_entitlement_cache(text) is
  'Сверка А: кэш энтайтлмента против реестра. Зовёт recompute_*/revoke_* и журналирует разницу. TRIP-153.';

alter function public.reconcile_entitlement_cache(text) owner to postgres;
revoke all on function public.reconcile_entitlement_cache(text) from public, anon, authenticated;
grant execute on function public.reconcile_entitlement_cache(text) to service_role;

-- Раз в час, смещение 17 минут — чтобы не совпадать с тиками напоминаний
-- (0/15/30/45) и их сторожа (7/22/37/52). Режим report НАМЕРЕННО: первый
-- прогон в проде ничего не меняет, перевод на apply — отдельной миграцией.
-- Повторное расписание того же имени в pg_cron идемпотентно.
select cron.schedule(
  'entitlement-cache-reconcile',
  '17 * * * *',
  $$ select public.reconcile_entitlement_cache('report'); $$
);
