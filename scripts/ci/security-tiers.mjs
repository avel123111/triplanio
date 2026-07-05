// ─────────────────────────────────────────────────────────────────────────────
// Security tier manifest — SINGLE SOURCE OF TRUTH for RLS + grant expectations.
//
// TRIP-190 Ф2. Каждая таблица public / secdef-RPC / storage-бакет отнесена к
// одному ярусу с целевыми грантами и формой политик. Ф3 приводит реальность к
// этому манифесту; Ф4 (scripts/ci/check-security-tiers.mjs, TRIP-120) сверяет
// живые pg_policies + relacl с манифестом и роняет билд на дрейфе.
//
// Ярусы:
//   A — контент трипа.  SELECT = участник, WRITE = редактор (can_edit_trip).
//   B — авторитетное (деньги/роли/настройки/токены). Ноль прямого клиентского
//       DML; пишет только service_role / edge / SECURITY DEFINER.
//   C — личное пользователя. Всё скоупится auth.uid() (свои строки).
//   D — справочник/системное. Пишет только service_role; клиент максимум SELECT.
//
// Инварианты (проверяет Ф4):
//   I3a  anon НЕ имеет INSERT/UPDATE/DELETE НИГДЕ (anonDml=false везде).
//   I3b  authenticated имеет DML только на ярусах A и C.
//   I2   ярус A: каждая write-политика роль-осведомлённая (can_edit_trip /
//        is_trip_creator), НЕ голый is_trip_participant.
//   B/D  authenticated без DML; SELECT только там, где клиент реально читает.
//
// status: 'aligned' — реальность уже совпадает с целью (проверено на dev/prod).
//         'pending' — Ф3 должна привести к цели (см. note).
// ─────────────────────────────────────────────────────────────────────────────

export const TIERS = {
  A: 'trip content — SELECT participant / WRITE can_edit_trip',
  B: 'authoritative — no client DML, service_role/edge only',
  C: 'user-owned — scoped by auth.uid()',
  D: 'reference/system — service_role writes, client SELECT only',
};

// anonDml/authDml/anonSelect/authSelect = ЦЕЛЕВЫЕ привилегии роли на таблице.
export const TABLES = {
  // ── Ярус A — контент трипа (Ф1 / TRIP-124 привёл к цели) ────────────────────
  activities:        { tier: 'A', write: 'can_edit_trip', anonDml: false, authDml: true, authSelect: true, status: 'aligned' },
  hotel_stays:       { tier: 'A', write: 'can_edit_trip', anonDml: false, authDml: true, authSelect: true, status: 'aligned' },
  transfers:         { tier: 'A', write: 'can_edit_trip', anonDml: false, authDml: true, authSelect: true, status: 'aligned' },
  city_visits:       { tier: 'A', write: 'can_edit_trip', anonDml: false, authDml: true, authSelect: true, status: 'aligned' },
  trip_services:     { tier: 'A', write: 'can_edit_trip', anonDml: false, authDml: true, authSelect: true, status: 'aligned' },
  trip_budgets:      { tier: 'A', write: 'can_edit_trip', anonDml: false, authDml: true, authSelect: true, status: 'aligned' },
  budget_categories: { tier: 'A', write: 'can_edit_trip', anonDml: false, authDml: true, authSelect: true, status: 'aligned' },
  budget_expenses:   { tier: 'A', write: 'can_edit_trip', anonDml: false, authDml: true, authSelect: true, status: 'aligned' },
  // роль поверх private-модели TRIP-118: can_edit_trip AND (visibility='shared' OR created_by=self)
  trip_documents:    { tier: 'A', write: 'can_edit_trip+visibility', anonDml: false, authDml: true, authSelect: true, status: 'aligned' },

  // ── Ярус B — авторитетное ───────────────────────────────────────────────────
  product:           { tier: 'B', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned' },
  provider_price:    { tier: 'B', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned' },
  webhook_event:     { tier: 'B', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned' },
  provider_customer: { tier: 'B', write: 'service_role', anonDml: false, authDml: false, authSelect: true,  status: 'aligned', note: 'authenticated читает свою строку' },
  purchase:          { tier: 'B', write: 'service_role', anonDml: false, authDml: false, authSelect: true,  status: 'aligned', note: 'authenticated читает свои покупки' },
  subscription:      { tier: 'B', write: 'service_role', anonDml: false, authDml: false, authSelect: true,  status: 'aligned', note: 'authenticated читает свою подписку' },
  // trip_members: политики роль-осведомлённые (is_trip_creator), НО authenticated
  // ещё держит INSERT/DELETE-гранты (TRIP-62 снял только UPDATE). Все мутации идут
  // через edge (service_role) → снять INSERT/DELETE у authenticated.
  trip_members:      { tier: 'B', write: 'service_role', anonDml: false, authDml: false, authSelect: true,  status: 'aligned', note: 'Ф3: REVOKE INSERT,DELETE ON trip_members FROM authenticated (пишет только edge)' },
  // trips: РЕШЕНО (Pavel) — полный Ярус B, никаких поколоночных исключений.
  // Поколоночные гранты — хрупкий анти-паттерн (TRIP-62: owner включал аддоны PATCH'ем
  // details). Все записи через edge. Единственный прямой клиентский write — обложка в
  // ManualPlanner сразу после создания — перевести на edge/RPC в Ф3.
  trips:             { tier: 'B', write: 'service_role/edge', anonDml: false, authDml: false, authSelect: true, status: 'aligned', note: 'Ф3: REVOKE ALL DML ON trips FROM authenticated; reroute ManualPlanner cover-update через edge (updateTripSettings)' },
  // Токены/блоки — серверные, клиент не должен ни писать, ни читать токены.
  trip_invite_links: { tier: 'B', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'Ф3: REVOKE ALL FROM anon,authenticated (invite-токены, только edge)' },
  telegram_link_tokens: { tier: 'B', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'Ф3: REVOKE DML FROM anon,authenticated (link-токены)' },
  trip_member_blocks:   { tier: 'B', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'Ф3: REVOKE DML FROM anon,authenticated' },
  // Ярус B (уточнено в Ф3c): 0 обращений клиента из src/ — таблица edge-only,
  // authenticated DML снят (закрывает REST-обход read-only для viewer, I5).
  trip_telegram_integrations: { tier: 'B', write: 'service_role/edge', anonDml: false, authDml: false, authSelect: true, status: 'aligned', note: 'Ф3c: REVOKE INSERT,UPDATE,DELETE FROM authenticated + drop _write политику (всё через telegram* edge)' },

  // ── Ярус C — личное пользователя (политики скоупят auth.uid(); снять anon DML) ─
  users:              { tier: 'C', write: 'self (id=auth.uid())',      anonDml: false, authDml: true, authSelect: true, status: 'aligned', note: 'Ф3: REVOKE DML FROM anon (колонки энтайтлмента уже отозваны — TRIP-62/платёжка)' },
  user_custom_visits: { tier: 'C', write: 'self (user_id=auth.uid())', anonDml: false, authDml: true, authSelect: true, status: 'aligned', note: 'Ф3: REVOKE DML FROM anon' },
  notifications:      { tier: 'C', write: 'self (user_id=auth.uid())', anonDml: false, authDml: true, authSelect: true, status: 'aligned', note: 'Ф3: REVOKE DML FROM anon (вставку делает service_role)' },
  chat_reads:         { tier: 'C', write: 'self (user_id=auth.uid())', anonDml: false, authDml: true, authSelect: true, status: 'aligned', note: 'Ф3: REVOKE DML FROM anon' },
  partner_clicks:     { tier: 'C', write: 'self (user_id=auth.uid())', anonDml: false, authDml: true, authSelect: true, status: 'aligned', note: 'Ф3: REVOKE DML FROM anon' },
  // chat_messages: РЕШЕНО (Pavel) — viewer ПИШЕТ (чат коллаборативный). insert остаётся
  // is_trip_participant, update/delete=self. В Ф3 только снять латентный anon DML.
  chat_messages:      { tier: 'C', write: 'participant-insert/self-edit', anonDml: false, authDml: true, authSelect: true, status: 'aligned', note: 'Ф3: REVOKE DML FROM anon; insert=is_trip_participant (viewer пишет — решено)' },

  // ── Ярус D — справочник/системное (снять клиентский DML; SELECT где читаем) ───
  cities:               { tier: 'D', write: 'service_role', anonDml: false, authDml: false, authSelect: true,  status: 'aligned', note: 'Ф3: REVOKE DML FROM anon,authenticated; клиент читает города (SELECT оставить)' },
  fx_rates:             { tier: 'D', write: 'service_role', anonDml: false, authDml: false, authSelect: true,  status: 'aligned', note: 'Ф3: REVOKE DML; клиент читает курсы' },
  chats:                { tier: 'D', write: 'service_role', anonDml: false, authDml: false, authSelect: true,  status: 'aligned', note: 'Ф3: REVOKE DML; контейнер чата создаётся триггером, клиент читает' },
  geo_admin1:           { tier: 'D', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'Ф3: REVOKE DML; доступ только через search_gazetteer (secdef)' },
  geo_alt_names:        { tier: 'D', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'Ф3: REVOKE DML; только через RPC' },
  geo_country:          { tier: 'D', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'Ф3: REVOKE DML; только через RPC' },
  geo_gazetteer:        { tier: 'D', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'Ф3: REVOKE DML; только через RPC' },
  geocode_cache:        { tier: 'D', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'Ф3: REVOKE DML; серверный кэш' },
  geocode_queue:        { tier: 'D', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'Ф3: REVOKE DML; серверная очередь' },
  geocode_rate_bucket:  { tier: 'D', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'Ф3: REVOKE DML' },
  ai_model_prices:      { tier: 'D', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'Ф3: REVOKE DML; прайс-бук' },
  ai_usage_events:      { tier: 'D', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'Ф3: REVOKE DML; учёт стоимости' },
  n8n_chat_histories:   { tier: 'D', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'Ф3: REVOKE DML (RLS включён TRIP-46, гранты остались)' },
  rate_limit_hits:      { tier: 'D', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'Ф3: REVOKE DML; корзины rate-limit' },
  telegram_reminder_logs: { tier: 'D', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'Ф3: REVOKE DML; логи напоминаний' },
};

// SECURITY DEFINER функции — целевой EXECUTE. После TRIP-49/54 поверхность в норме.
export const FUNCTIONS = {
  // Намеренно исполнимы anon (несущие предикаты RLS TO public + публичный поиск).
  publicExec: ['is_trip_participant', 'is_trip_creator', 'search_gazetteer'],
  // Легитимно вызываются authenticated (структурные мутации + чтение).
  authExec: [
    'add_city', 'add_layover_transfer', 'remove_city', 'reorder_cities',
    'set_city_nights', 'set_trip_start_date', 'create_trip', '_can_edit_trip',
    'get_trip_owner_profiles', 'get_trip_participant_profiles', 'get_user_travel_stats',
    'link_pending_invites', 'geocode_dequeue', 'geocode_enqueue', 'geocode_serve_fair',
  ],
  // Всё остальное secdef — internal (anon:false, auth:false): recompute_*, revoke_*,
  // ensure_trip_budget, seed_budget_on_trip, sync_budget_expense, rate_limit_*,
  // enforce_trip_limit, is_trip_pro, is_user_pro, anonymize_my_account, take_geocode_token,
  // notify_booking_added, trg_recompute_transfer, count_active_owned_trips, active_owned_trips,
  // _trip_anchor_date, auth_email_status. → Ф4 проверяет anon=false AND auth=false.
  internalDefault: true,
};

export const BUCKETS = {
  avatars: { public: true,  policies: ['select', 'insert', 'update', 'delete'], note: 'публичный; TRIP-117 delete-политика' },
  trips:   { public: false, policies: ['select', 'insert', 'update', 'delete'], note: 'приватный; TRIP-118 private-файлы' },
};

// Продуктовые решения — РЕШЕНЫ (Pavel, 2026-07-05), зафиксированы в TABLES выше:
export const DECISIONS = [
  'chat_messages: viewer ПИШЕТ в чат (коллаборативно). insert=is_trip_participant. [решено: да]',
  'trips: полный Ярус B — без поколоночных исключений, все записи через edge. [решено: Ярус B]',
  'trip_telegram_integrations: viewer НЕ привязывает Telegram — гейт can_edit_trip в БД (I5). [решено: нет]',
];
