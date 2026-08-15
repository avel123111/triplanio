-- TRIP-425 добор (Ф4 волна 3, эпик TRIP-374) — снять клиентский EXECUTE у двух
-- осиротевших предикатов, которые прошлый слайс (миграция 20260815200000) не убрал.
--
-- Контекст: слайс 1 дропнул политики trip_members_* и trip_documents-доступ,
-- но сами функции-предикаты оставил гранёнными anon/authenticated. Проверено
-- read-only на dev ПОСЛЕ деплоя слайса 1:
--
--   • is_trip_creator(p_trip_id uuid) — SECURITY DEFINER; политик, её зовущих, НОЛЬ
--     (её держали только trip_members_insert/update/delete, дропнутые слайсом 1);
--     в src/**, functions/**, телах других функций — 0 вызовов (сверено
--     pg_policy + pg_get_functiondef). Осталась мёртвой, но client-исполнимой.
--   • _can_access_trip_document(p_trip_id uuid, p_visibility text, p_created_by uuid)
--     — SECURITY INVOKER; политик/вызывателей НОЛЬ; доступ к докам в бакете `trips`
--     гейтит _can_access_trip_file (readPredicate бакета), не она. Остаток старого
--     дизайна.
--
-- Обе — не в допустимом клиентском наборе (§1 хендоффа). Снимаем EXECUTE у ролей
-- юзера и PUBLIC (грабля дефолтного GRANT / TRIP-49). service_role EXECUTE НЕ
-- трогаем — если существует скрытый серверный вызыватель (напр. n8n), он не
-- сломается; REVOKE обратим. Сам DROP FUNCTION — осознанно НЕ здесь: необратим,
-- а воркфлоу n8n вне репо не сверить; закроется отдельным микро-шагом после проверки.

REVOKE EXECUTE ON FUNCTION public.is_trip_creator(p_trip_id uuid)
  FROM anon, authenticated, PUBLIC;

REVOKE EXECUTE ON FUNCTION public._can_access_trip_document(p_trip_id uuid, p_visibility text, p_created_by uuid)
  FROM anon, authenticated, PUBLIC;
