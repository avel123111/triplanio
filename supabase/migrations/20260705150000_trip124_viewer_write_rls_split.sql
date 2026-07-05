-- TRIP-124 — Бэк-защита записи viewer: роль-осведомлённый RLS на контент-таблицах.
--
-- Предыстория (broken access control, P0, подтверждён вживую на prod+dev):
-- у 8 контент-таблиц была ЕДИНСТВЕННАЯ политика "<t>_all" FOR ALL с проверкой
-- ТОЛЬКО на участие в трипе:
--     USING (is_trip_participant(trip_id)) WITH CHECK (is_trip_participant(trip_id))
-- is_trip_participant роль НЕ проверяет → любой active-участник, включая viewer,
-- писал брони/структуру/бюджет/сервисы напрямую через PostgREST, минуя _can_edit_trip.
-- Плюс на этих таблицах у anon/authenticated висели дефолтные DML-гранты, поэтому
-- единственным барьером была именно эта (дырявая) политика.
--
-- Канон авторизации (единый словарь предикатов — применяется одинаково на всех
-- контент-таблицах; см. TRIP-190/TRIP-120 — системный ярус):
--   * SELECT  → is_trip_participant(trip_id)          (viewer читает трип)
--   * WRITE   → _can_edit_trip(trip_id, auth.uid())   (owner/admin; viewer отсечён)
--   * anon    → без прямого DML (defense-in-depth; RLS его и так обнуляет)
--
-- _can_edit_trip (SECURITY DEFINER, role<>'viewer' AND active OR created_by) уже
-- существует и исполним authenticated (нужно для оценки политики). Серверные
-- SECURITY DEFINER пути (sync_budget_expense / seed_budget_on_trip / ensure_trip_budget,
-- edge/service_role, n8n) RLS обходят и НЕ затрагиваются.

-- ---------------------------------------------------------------------------
-- 8 однотипных контент-таблиц: дробим FOR ALL на пер-командные политики канона.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  content_tables text[] := array[
    'activities','hotel_stays','transfers','city_visits','trip_services',
    'trip_budgets','budget_categories','budget_expenses'
  ];
begin
  foreach t in array content_tables loop
    execute format('drop policy if exists %I on public.%I', t || '_all', t);

    execute format(
      'create policy %I on public.%I for select using (public.is_trip_participant(trip_id))',
      t || '_select', t);

    execute format(
      'create policy %I on public.%I for insert with check (public._can_edit_trip(trip_id, auth.uid()))',
      t || '_insert', t);

    execute format(
      'create policy %I on public.%I for update using (public._can_edit_trip(trip_id, auth.uid())) with check (public._can_edit_trip(trip_id, auth.uid()))',
      t || '_update', t);

    execute format(
      'create policy %I on public.%I for delete using (public._can_edit_trip(trip_id, auth.uid()))',
      t || '_delete', t);

    execute format('revoke insert, update, delete on public.%I from anon', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- trip_documents — уже расщеплён в TRIP-118 (private-защита по visibility/created_by).
-- SELECT НЕ трогаем (private-модель остаётся). В write-политики ДОБАВЛЯЕМ роль:
-- писать может только редактор (owner/admin), при этом private-строки чужих
-- пользователей по-прежнему недоступны. viewer теряет запись полностью.
-- ---------------------------------------------------------------------------
drop policy if exists "trip_documents_insert" on public.trip_documents;
create policy "trip_documents_insert" on public.trip_documents
  for insert
  with check (
    public._can_edit_trip(trip_id, auth.uid())
    and created_by = auth.uid()
  );

drop policy if exists "trip_documents_update" on public.trip_documents;
create policy "trip_documents_update" on public.trip_documents
  for update
  using (
    public._can_edit_trip(trip_id, auth.uid())
    and (visibility = 'shared' or created_by = auth.uid())
  )
  with check (
    public._can_edit_trip(trip_id, auth.uid())
    and (visibility = 'shared' or created_by = auth.uid())
  );

drop policy if exists "trip_documents_delete" on public.trip_documents;
create policy "trip_documents_delete" on public.trip_documents
  for delete
  using (
    public._can_edit_trip(trip_id, auth.uid())
    and (visibility = 'shared' or created_by = auth.uid())
  );

revoke insert, update, delete on public.trip_documents from anon;
