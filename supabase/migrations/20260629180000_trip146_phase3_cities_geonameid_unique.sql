-- TRIP-146 Phase 3 — geonameid становится уникальным ключом директории cities.
-- Постоянная схема → через CI/CD-миграцию (НЕ руками, правило 12). DATA-перезалив
-- строк cities остаётся отдельной операцией (scripts/cities-rebuild.sql, гоняет
-- Pavel по конвенции TRIP-69).
--
-- Partial (geonameid IS NOT NULL): при текущем состоянии все geonameid = NULL →
-- индекс создаётся над нулём строк (мгновенно). После перезалива он гарантирует
-- одну строку на geonameid. NULL разрешён множественно — ручные affiliate-строки
-- без GeoNames-матча (нон-сити Viator-направления) живут как geonameid = NULL.
create unique index if not exists cities_geonameid_key
  on public.cities (geonameid)
  where geonameid is not null;
