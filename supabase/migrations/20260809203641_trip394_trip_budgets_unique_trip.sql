-- TRIP-394 (Ф2 эпика TRIP-374): целостность строки бюджета в БД.
--
-- Бюджет трипа — синглтон: ровно одна строка trip_budgets на трип. Сегодня это
-- держится ТОЛЬКО процедурно — ensure_trip_budget вставляет `where not exists`,
-- а UNIQUE-констрейнта нет. В модели «единой двери» инвариант формы данных живёт
-- в БД (handoff Р4 §0: в БД — целостность), а не в приложении: шов settings
-- становится настоящим upsert по конфликту, а не «проверь-потом-вставь» с окном
-- гонки между двумя параллельными правками курсов.
--
-- Безопасно: дублей нет ни на dev, ни на prod (замер 2026-08-09, оба 0). На
-- всякий случай схлопываем возможные дубли ДЕТЕРМИНИРОВАННО перед констрейнтом —
-- миграция обязана быть самолечащейся на колонке, куда исторически писали в
-- обход (TRIP-281). Дубль мог родиться ТОЛЬКО из клиентского self-heal INSERT
-- (гонка двух правок курсов), а он пишет fx_overrides — поэтому оставляем
-- строку С непустыми курсами, при равенстве — самую раннюю. `ctid` — тай-брейк,
-- чтобы удаление было детерминированным даже при совпадении created_at.

delete from public.trip_budgets a
using public.trip_budgets b
where a.trip_id = b.trip_id
  and (
    (a.fx_overrides = '{}'::jsonb) and (b.fx_overrides <> '{}'::jsonb)
    or (a.fx_overrides = '{}'::jsonb) = (b.fx_overrides = '{}'::jsonb)
       and (a.created_at, a.ctid) > (b.created_at, b.ctid)
  );

alter table public.trip_budgets
  add constraint trip_budgets_trip_id_key unique (trip_id);
