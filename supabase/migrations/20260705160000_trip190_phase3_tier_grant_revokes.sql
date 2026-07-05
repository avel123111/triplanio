-- TRIP-190 Ф3a/b — least-privilege: снять латентные клиентские гранты по манифесту
-- ярусов (scripts/ci/security-tiers.mjs). Закрывает класс латентных грантов
-- Postgres-дефолта GRANT ALL (тот же механизм, что дал латентный P0 в TRIP-64).
--
-- НОЛЬ изменений поведения (проверено grep по src/ на `.from('<t>')`):
--   * Ярус C: клиент пишет свои строки под authenticated; anon писать не мог (RLS
--     обнуляет auth.uid()) — снимаем лишь висячий anon-DML.
--   * Ярус D server-only: 0 обращений клиента — доступ только через service_role и
--     SECURITY DEFINER RPC (geocode_*/search_gazetteer), которые грантами не гейтятся.
--   * cities/fx_rates/chats: клиент читает (SELECT остаётся), но не пишет.
--   * Ярус B trip_members: все мутации через edge (service_role); UPDATE и anon-DML
--     сняты в TRIP-62, снимаем оставшиеся INSERT/DELETE у authenticated.
-- service_role и SECURITY DEFINER функции не затрагиваются (владелец = postgres).

-- ── Ярус C — личные таблицы: снять висячий anon DML ──────────────────────────
revoke insert, update, delete on public.users                      from anon;
revoke insert, update, delete on public.user_custom_visits         from anon;
revoke insert, update, delete on public.notifications              from anon;
revoke insert, update, delete on public.chat_reads                 from anon;
revoke insert, update, delete on public.partner_clicks             from anon;
revoke insert, update, delete on public.chat_messages              from anon;
revoke insert, update, delete on public.trip_telegram_integrations from anon;

-- ── Ярус D — client-readable справочники: SELECT остаётся, снять DML ──────────
revoke insert, update, delete on public.cities   from anon, authenticated;
revoke insert, update, delete on public.fx_rates from anon, authenticated;
revoke insert, update, delete on public.chats    from anon, authenticated;

-- ── Ярус D — server-only: снять ВСЁ у клиентских ролей ───────────────────────
revoke all on public.geo_admin1             from anon, authenticated;
revoke all on public.geo_alt_names          from anon, authenticated;
revoke all on public.geo_country            from anon, authenticated;
revoke all on public.geo_gazetteer          from anon, authenticated;
revoke all on public.geocode_cache          from anon, authenticated;
revoke all on public.geocode_queue          from anon, authenticated;
revoke all on public.geocode_rate_bucket    from anon, authenticated;
revoke all on public.ai_model_prices        from anon, authenticated;
revoke all on public.ai_usage_events        from anon, authenticated;
revoke all on public.n8n_chat_histories     from anon, authenticated;
revoke all on public.rate_limit_hits        from anon, authenticated;
revoke all on public.telegram_reminder_logs from anon, authenticated;
revoke all on public.trip_invite_links      from anon, authenticated;
revoke all on public.telegram_link_tokens   from anon, authenticated;
revoke all on public.trip_member_blocks     from anon, authenticated;

-- ── Ярус B — trip_members: только edge/service_role пишет ─────────────────────
revoke insert, delete on public.trip_members from authenticated;
