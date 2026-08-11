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
//
// authDml (bool) — есть ли у authenticated ХОТЬ КАКОЙ-ТО прямой DML (ось ярус-
// инварианта I3b: разрешён только на A/C). Опциональные authInsert/authUpdate/
// authDelete (bool) УТОЧНЯЮТ, какой именно op открыт — для случая ЧАСТИЧНОГО
// закрытия двери (напр. UPDATE/DELETE сняты, INSERT ещё нужен регистрации).
// Когда per-op поле задано, LIVE-2e сверяет ровно его ЭФФЕКТИВНОЕ право
// (has_any_column_privilege/has_table_privilege) в ОБЕ стороны (снят → обязан
// быть снят, оставлен → обязан быть); где per-op не задан — падает на authDml
// (все 40 прочих таблиц не трогаем). Инвариант: authDml === OR(per-op), иначе
// манифест сам себе противоречит.
export const TABLES = {
  // ── Ярус A — контент трипа (Ф1 / TRIP-124 привёл к цели) ────────────────────
  activities:        { tier: 'A', write: 'can_edit_trip', anonDml: false, authDml: true, authSelect: true, status: 'aligned' },
  hotel_stays:       { tier: 'A', write: 'can_edit_trip', anonDml: false, authDml: true, authSelect: true, status: 'aligned' },
  transfers:         { tier: 'A', write: 'can_edit_trip', anonDml: false, authDml: true, authSelect: true, status: 'aligned' },
  city_visits:       { tier: 'A', write: 'can_edit_trip', anonDml: false, authDml: true, authSelect: true, status: 'aligned' },
  trip_services:     { tier: 'A', write: 'can_edit_trip', anonDml: false, authDml: true, authSelect: true, status: 'aligned' },
  // роль поверх private-модели TRIP-118: can_edit_trip AND (visibility='shared' OR created_by=self)
  trip_documents:    { tier: 'B', write: 'service_role/edge', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'единый шов записи trip-document + _shared/mutate.ts; удаление построчно (private⇒автор) через guardRow; чтение — getTripDetails под service_role (visibility=shared OR created_by=self, TRIP-118); во фронте ноль .from(trip_documents); гранты authenticated DML/SELECT и anon SELECT сняты, 4 RLS-политики удалены ПОСЛЕ revoke, RLS остаётся deny-all' },

  // ── Ярус B — авторитетное ───────────────────────────────────────────────────
  // Бюджет (TRIP-394 Ф2, шаг C) — ПЕРВЫЙ контент-домен, переведённый на единый шов
  // записи `_shared/mutate.ts`. Пишет только service_role (шов + триггеры авто-трат
  // и сброса fx); клиентского DML/SELECT нет — читает `getTripDetails` под
  // service_role, во фронте ноль `.from('budget_*')`. Не ярус A: тот ТРЕБУЕТ
  // authDml=true и роль-осведомлённую write-политику (I2), а здесь клиент не пишет
  // вовсе. Гранты authenticated (INSERT/UPDATE/DELETE/SELECT) и остаточный SELECT у
  // anon сняты; 12 RLS-политик удалены ПОСЛЕ revoke; RLS остаётся включённой
  // (deny-all без политик), service_role обходит. LIVE-2e сверит, что DML снят.
  trip_budgets:      { tier: 'B', write: 'service_role/edge', anonDml: false, authDml: false, authSelect: false, status: 'aligned' },
  budget_categories: { tier: 'B', write: 'service_role/edge', anonDml: false, authDml: false, authSelect: false, status: 'aligned' },
  budget_expenses:   { tier: 'B', write: 'service_role/edge', anonDml: false, authDml: false, authSelect: false, status: 'aligned' },
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
  // ⚠ ГДЕ ЖИВЁТ РЕШЕНИЕ «viewer НЕ привязывает Telegram»: Ф3c дропнула
  // _write-политику, а не перевела её на can_edit_trip, поэтому в БД предиката
  // РОЛИ по этой таблице НЕТ вовсе — правило целиком держат telegram*-функции.
  // Полтора месяца они стояли на участии, то есть решение было записано и не
  // исполнялось; ярусный страж этого не видел и не увидит (он смотрит гранты и
  // политики, а гейт — в TS). Единственное, что его держит, — гейт `editor` в
  // telegramStartLink/telegramSetActive/telegramDisconnect (TRIP-274).
  trip_telegram_integrations: { tier: 'B', write: 'service_role/edge', anonDml: false, authDml: false, authSelect: true, status: 'aligned', note: 'Ф3c: REVOKE INSERT,UPDATE,DELETE FROM authenticated + drop _write политику (всё через telegram* edge); роль проверяют сами функции — гейт editor, TRIP-274' },
  // chat_messages: был ярус C с прямым клиентским INSERT (viewer пишет — решение
  // Pavel в силе). TRIP-296 перевёл запись на secdef-функцию send_chat_message:
  // RLS не могла проверить автора (user_id приходил с клиента → подмена участника
  // и БОТА), время и связку чат↔трип, а вставка сообщения и запуск ассистента были
  // двумя операциями с клиента. Теперь клиент только читает.
  chat_messages:     { tier: 'B', write: 'send_chat_message (secdef RPC)', anonDml: false, authDml: false, authSelect: true, status: 'aligned', note: 'TRIP-296: REVOKE INSERT,UPDATE,DELETE FROM authenticated + drop insert/update/delete политик; запись только через RPC' },

  // ── Ярус C — личное пользователя (политики скоупят auth.uid(); снять anon DML) ─
  users:              { tier: 'C', write: 'edge account/profile (service_role) + INSERT authenticated (регистрация, врем.)', anonDml: false, authDml: true, authInsert: true, authUpdate: false, authDelete: false, authSelect: true, status: 'aligned', note: 'TRIP-400 шаг C: закрыта дверь ПРАВКИ — REVOKE UPDATE (table+поколоночный) и DELETE у authenticated; правка профиля только через edge account/profile под service_role. INSERT+SELECT ПОКА остаются (снимет домен регистрации — там insert().select() профиля), поэтому ярус остаётся C и authDml=true (частичный клиентский DML). per-op authUpdate/authDelete=false — LIVE-2e сверяет, что сняты ПОШТУЧНО; anon без DML (Ф3)' },
  // TRIP-402 шаг C: домен статистики закрыт — edge-only. Запись через шов
  // user-place (service_role, scope user_id=actor), чтение статов через RPC
  // get_user_travel_stats(p_actor) под service_role (EXECUTE у authenticated снят
  // в A+B). Клиент таблицу напрямую не пишет/не читает. Полный close в ОДИН заход
  // (в отличие от users): REVOKE INSERT/UPDATE/DELETE/SELECT у authenticated +
  // остаточный SELECT у anon; 4 RLS ucv_* удалены ПОСЛЕ revoke; RLS остаётся
  // deny-all, service_role обходит. Не ярус C: клиент не пишет вовсе. LIVE-2e
  // сверит, что DML+SELECT сняты (has_*_privilege).
  user_custom_visits: { tier: 'B', write: 'service_role/edge', anonDml: false, authDml: false, authSelect: false, status: 'aligned' },
  notifications:      { tier: 'C', write: 'self (user_id=auth.uid())', anonDml: false, authDml: true, authSelect: true, status: 'aligned', note: 'Ф3: REVOKE DML FROM anon (вставку делает service_role)' },
  chat_reads:         { tier: 'C', write: 'self (user_id=auth.uid())', anonDml: false, authDml: true, authSelect: true, status: 'aligned', note: 'Ф3: REVOKE DML FROM anon' },
  partner_clicks:     { tier: 'C', write: 'self (user_id=auth.uid())', anonDml: false, authDml: true, authSelect: true, status: 'aligned', note: 'Ф3: REVOKE DML FROM anon' },

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
  ai_usage_events:      { tier: 'D', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'Ф3: REVOKE DML; учёт стоимости (cost_usd пишет n8n)' },
  n8n_chat_histories:   { tier: 'D', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'Ф3: REVOKE DML (RLS включён TRIP-46, гранты остались)' },
  rate_limit_hits:      { tier: 'D', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'Ф3: REVOKE DML; корзины rate-limit' },
  telegram_reminder_logs: { tier: 'D', write: 'service_role', anonDml: false, authDml: false, authSelect: false, status: 'aligned', note: 'Ф3: REVOKE DML; логи напоминаний' },
};

// SECURITY DEFINER функции — вторая «дверь» (privileged bypass RLS). Ф4 (LIVE)
// сверяет EXECUTE-гранты с этими списками + tripwire «client-вызываемая функция
// обязана ссылаться на авторизацию в теле». Инварианты:
//   IF1  publicExec — anon+authenticated МОГУТ EXECUTE (read-only предикаты + поиск).
//   IF2  authExec   — ТОЛЬКО authenticated (anon обязан быть false).
//   IF3  всё прочее secdef → internal: anon=false И auth=false (не client-вызываема).
//        Новая функция с дефолтным PUBLIC EXECUTE (грабля Postgres) → страж падает.
//   IF4  client-вызываемая функция без ссылки на авторизацию в теле → страж падает
//        (кроме authzExempt). Ловит secdef-мутатор, забывший проверить права.
//        ПРЕДЕЛ (осознанный): это проверка НАЛИЧИЯ ссылки (regex), а не факта, что
//        функция гейтит правильный трип/право — тонкий случай остаётся на ревью.
export const FUNCTIONS = {
  // _can_access_trip_file / _can_write_trip_file — предикаты storage-RLS приватного
  // бакета `trips` (чтение и запись, TRIP-274). Оба SECURITY DEFINER, иначе их
  // private-проверка слепнет под RLS вызывающего (гигиена TRIP-120), и оба
  // исполнимы anon+authenticated, потому что storage-политики стоят TO public:
  // для anon они вернут false, но обязаны вернуть, а не упасть «permission denied»
  // посреди вычисления политики. Слагаемые (`_trip_file_trip_id`,
  // `_trip_file_not_others_private`) — internal, гранта клиенту нет (IF3).
  publicExec: ['is_trip_participant', 'is_trip_creator', 'search_gazetteer', 'search_gazetteer_batch', 'nearest_cities', '_can_access_trip_file', '_can_write_trip_file'],
  authExec: [
    '_can_edit_trip', 'add_city', 'add_layover_transfer', 'create_trip',
    'remove_city', 'reorder_cities', 'set_city_nights', 'set_trip_start_date',
    'get_trip_owner_profiles',
    // get_trip_participant_profiles убрана (TRIP-403 шаг C): DROP, поглощена
    // get_my_trip_cards (edge getTrips, ярус B) — клиентского вызывателя нет.
    // get_user_travel_stats убран (TRIP-402): EXECUTE у authenticated отозван,
    // теперь service_role-only, зовётся edge getTravelStats под service_role.
    // TRIP-296: единственный путь записи в чат. Авторизация в теле —
    // is_trip_participant(trip_id) + автор из auth.uid() (IF4 её видит).
    'send_chat_message',
  ],
  // client-вызываемые функции, которым НЕ нужна ссылка на авторизацию в теле
  // (tripwire их пропускает): search_gazetteer(_batch) — публичный текстовый
  // поиск по газеттиру, без per-user данных (batch = тот же поиск пачкой, TRIP-214).
  // nearest_cities — тот же публичный газеттир, но резолв координат → ближайшие
  // города (TRIP-226, inhouse reverse geocoding «мой город»); per-user данных нет.
  // (geocode_*/link_pending_invites убраны из client-вызываемых в гигиене
  // TRIP-120 — REVOKE authenticated EXECUTE, теперь internal; см. миграцию
  // 20260705180000_trip120_hygiene_revoke_vestigial_execute.)
  authzExempt: ['search_gazetteer', 'search_gazetteer_batch', 'nearest_cities'],
};

// Storage-бакеты. Ф4 (LIVE) сверяет: живой флаг `public` совпадает с манифестом
// (ловит «приватный бакет вдруг стал публичным»), и что для бакета есть все
// перечисленные политики `<bucket>_<cmd>` на storage.objects (ловит дроп политики).
// TRIP-48: два дополнительных инварианта закрывают класс «анонимный листинг»:
//   • публичный бакет НЕ имеет SELECT-политики (раздача идёт по /object/public/
//     мимо RLS; SELECT рулит только `.list()` → анонимный листинг всего бакета);
//   • не существует публичного бакета ВНЕ манифеста (слепая зона, из-за которой
//     share-cards/share-maps проскользнули незамеченными).
// TRIP-274: проверки НАЛИЧИЯ мало — она была зелёной ровно тогда, когда все четыре
// команды бакета `trips` стояли на ЧИТАЮЩЕМ предикате и viewer клал байты в папку
// трипа: политика существовала, просто пускала не тех. Поэтому у бакета можно
// объявить ожидаемые предикаты, и LIVE сверяет ТЕКСТ политики — тем же приёмом,
// каким инвариант I2 держит роль-осведомлённость таблиц яруса A:
//   readPredicate  — обязан вызываться в SELECT-политике и НЕ должен вызываться
//                    в write-политиках: они склеиваются через OR, поэтому
//                    `read(name) OR write(name)` содержит write и всё равно
//                    пускает участника — гейт обойдён дизъюнкцией при зелёном
//                    страже (нашёл ревьюер Codex на PR #678);
//   writePredicate — обязан вызываться в INSERT/UPDATE/DELETE и НЕ должен в
//                    SELECT (иначе чтение молча ужалось до редакторов и участник
//                    перестал видеть файлы трипа).
// Сверка идёт по ВЫЗОВУ (`имя(`) на границе идентификатора, а не по подстроке:
// иначе `_can_access_trip_file` находился бы внутри `_can_access_trip_file_v2`,
// и запрет read-предиката в write-политике давал бы ложное падение на любой
// паре, где одно имя — префикс другого. ПРЕДЕЛ остаётся: страж видит ИМЕНА в
// тексте политики, а не смысл предиката — что именно проверяет функция с этим
// именем, остаётся на ревью (тот же предел, что у IF4).
export const BUCKETS = {
  avatars: { public: true,  policies: ['insert', 'update', 'delete'], note: 'публичный; детерм. ключ <uid>/avatar, БЕЗ SELECT (TRIP-48)' },
  trips:   {
    public: false,
    policies: ['select', 'insert', 'update', 'delete'],
    readPredicate: '_can_access_trip_file',
    writePredicate: '_can_write_trip_file',
    note: 'приватный; TRIP-118 private-файлы; TRIP-274 чтение=участие, запись=_can_edit_trip (оба DEFINER, общая половина «не чужой private»); черновая обложка — только своя папка _drafts/<uid>/ (TRIP-281)',
  },
};

// Продуктовые решения — РЕШЕНЫ (Pavel, 2026-07-05), зафиксированы в TABLES выше:
export const DECISIONS = [
  'chat_messages: viewer ПИШЕТ в чат (коллаборативно) — решение в силе, но проверка переехала из RLS в send_chat_message (TRIP-296: RLS не умела проверить автора). [решено: да]',
  'trips: полный Ярус B — без поколоночных исключений, все записи через edge. [решено: Ярус B]',
  // Формулировка «гейт can_edit_trip в БД» была НЕВЕРНА с момента Ф3c: политику
  // дропнули, а не переписали, и решение полтора месяца не исполнялось (viewer
  // прямым вызовом API отключал бота всему трипу). Исправлено в TRIP-274 —
  // гейт `editor` в самих telegram*-функциях. Это ярус B: правило по построению
  // живёт в edge, а не в RLS, поэтому страж его не проверяет.
  'trip_telegram_integrations: viewer НЕ привязывает Telegram — гейт editor в telegram* edge-функциях (не в RLS: у таблицы нет write-политики). [решено: нет]',
];

// ─────────────────────────────────────────────────────────────────────────────
// ДВЕРИ (TRIP-274). Ярусы выше отвечают на «что защищено», DOORS — на «какую
// ступень спрашивает каждая edge-функция».
//
// Зачем отдельно от всего прочего: дыра, которую чинил TRIP-274, была НЕ в
// правиле и НЕ в политике. Правило было верное, политика на месте — а
// telegramStartLink спрашивал «ты вообще участник?» там, где нужно «ты
// редактор?». Ни один страж такого не видит: гранты в порядке, политики в
// порядке, тесты правила зелёные. Увидеть можно только сверив, КАКУЮ ступень
// зовёт каждая дверь, со списком, который кто-то однажды утвердил.
//
// ★ РОЛЬ, дающая ступень `editor`, живёт в ЧЕТЫРЁХ местах — канон списка и
// последствий в шапке `EDITOR_ROLES` (_shared/tripStep.ts). Пару SQL↔TS сверяет
// LIVE-ассерт `checkEditorRoles`.
//
// Ступени вложены: owner ⊃ editor ⊃ participant (см. _shared/tripStep.ts).
//
// Карта ТОТАЛЬНАЯ: строка обязана быть у КАЖДОЙ папки в supabase/functions,
// включая негейтовые. Частичная карта не видит функцию, которая не зовёт гейта
// вовсе — а это и есть самый тяжёлый случай: так стражу был невидим
// checkSubscriptionStatus, единственная дверь к данным трипа без единой
// проверки. Молчание манифеста обязано означать «такой функции нет», а не
// «функция ничего не проверяет». Новая папка без строки роняет сборку.
//
// Значения (DOORS_VALUES):
//   ПРОВЕРЯЕМЫЕ — страж сверяет со ступенью, которую функция реально зовёт:
//     participant — viewer ПРОХОДИТ (чтение, чат, шеринг, копия к себе)
//     editor      — меняет план трипа: контент, настройки, участники, каналы
//   ОБЪЯВИТЕЛЬНЫЕ — страж НЕ проверяет, но требует объявить:
//     owner    — `trips.created_by === caller`, проверка руками на месте
//     self     — своя строка / свой аккаунт (`user.id`), трипа не касается
//     auth     — любой залогиненный, трип не при чём (справочники, прайсы)
//     token    — владение секретом в запросе (share_token, invite-токен, подпись)
//     n8n      — Bearer N8N_SECRET, вызов сервер-сервер
//     public   — без аутентификации вовсе (по замыслу, держится rate-limit)
//
// ★ SEAM-ДВЕРЬ (TRIP-394) — ОТДЕЛЬНАЯ ФОРМА, значение = МАССИВ гейтов, напр.
//   `['editor', 'pro']`. Такова дверь, чей `index.ts` просто зовёт
//   `mutate({ slug })`: сам гейт (`isCallerEditor` + `is_trip_pro`) живёт в шве
//   `_shared/mutate.ts` (`checkRequirement`), а право по действиям — в
//   спецификации ресурса `_shared/resources/<slug>.ts` (поле `requires`). Страж
//   грепает ТОЛЬКО `index.ts`, поэтому ступень там невидима ему по построению.
//   НО значение здесь НЕ объявительное: `check-security-tiers` МАШИННО сверяет
//   этот массив с `requires` спецификации (все действия обязаны требовать одно
//   и то же множество, и оно обязано совпасть с массивом). Токены массива — из
//   словаря `SEAM_GATE_TOKENS`, который сам выведен из `checkRequirement` шва
//   (spec не может потребовать гейт, которого шов не реализует). Расхождение
//   манифест↔спецификация↔шов = красный.
//
// ★ ЧТО СТРАЖ НЕ ЛОВИТ (граница инструмента, выписана намеренно — у соседних
// инвариантов IF4 и предикатов бакета она есть, а у дверей не было). Прогон
// семи подделок: ловятся «названа не та ступень» и «ступень убрана вместе с
// вызовом». ПРОПУСКАЮТСЯ:
//   1. гейт вызван, но результат не применён (`await isCallerEditor(...)` без if)
//   2. условие инвертировано (`if (ok) return 403`)
//   3. гейт стоит ПОСЛЕ записи в БД
//   4. гейт спрашивает про ЧУЖОЙ trip_id (не тот, который меняем)
//   5. гейт под флагом/условием (`if (strict) ...`)
//   6. гейт на одной из двух веток обработчика
//   7. объявительное значение — это ДОКУМЕНТАЦИЯ, а не проверка: снятый
//      `created_by`-гейт под строкой 'owner' страж не увидит
// Причина одна: страж читает ИМЕНА вызовов, а не поток управления. Усиливать
// его до разбора условий не надо — это начало своего линтера, поймает три
// случая из семи и создаст ложное чувство полноты.

/** Значения, которые страж действительно СВЕРЯЕТ с кодом. Остальные объявительные. */
export const STEP_VALUES = new Set(['participant', 'editor']);

/** Весь словарь: проверяемые ступени + объявительные. Вложенность задана
 *  построением — второй рукописный список ступеней разъехался бы с первым. */
export const DOORS_VALUES = new Set([...STEP_VALUES, 'owner', 'self', 'auth', 'token', 'n8n', 'public']);

/**
 * Токены, которые может нести seam-дверь (массив-значение) и `requires` действия
 * спецификации ресурса. Это ровно то, что реализует `checkRequirement` в
 * `_shared/mutate.ts` — держим списком здесь, а тест сверяет его с ЖИВЫМ телом
 * шва (`parseGateTokensFromSeam`), чтобы spec не мог потребовать гейт, которого
 * шов не знает. `participant` в шве пока не реализован — появится там, появится
 * и тут (иначе тест сверки покраснеет).
 */
export const SEAM_GATE_TOKENS = new Set(['editor', 'self', 'pro']);

export const DOORS = {
  // ── participant: viewer проходит осознанно ──
  getTripDetails:        'participant', // чтение трипа
  callTriplanioAi:       'participant', // обращение к ассистенту = сообщение в чат
  copyTrip:              'participant', // копия создаётся как СВОЙ трип
  ensureShareToken:      'participant', // ссылка открывает то, что зритель и так видит (TRIP-202)
  resolveProfiles:       'participant', // чтение профилей участников
  render_share_card:     'participant', // рендер карточки, только чтение
  telegramGetIntegration:'participant', // чтение статуса привязки
  parseBookingWithAi:    'participant', // распознавание брони, в БД не пишет
  checkSubscriptionStatus: 'participant', // Pro-статус трипа видит всякий, кто трип открывает

  // ── editor: меняет план трипа ──
  addOfflineTripMember:  'editor',
  createTripInviteLink:  'editor',
  inviteTripMember:      'editor',
  removeTripMember:      'editor',      // ИЛИ своя строка — вторая ось, см. код
  resendTripInvite:      'editor',
  updateTripMemberRole:  'editor',
  updateTripSettings:    'editor',
  telegramDisconnect:    'editor',      // ИЛИ своя строка — вторая ось, см. код
  telegramSetActive:     'editor',
  telegramStartLink:     'editor',
  telegramWebhook:       'editor',      // шов ЗАПИСИ привязки, перепроверяет при редиме

  // ── seam-двери: гейт в шве _shared/mutate.ts, сверяется с requires спецификации (TRIP-394) ──
  trip_budget:           ['editor', 'pro'],  // expense/category/settings; авто-траты идут мимо (триггер)
  trip_document:         ['editor'],          // doc create/delete; delete построчно (private ⇒ author), Pro нигде
  account:               ['self'],            // profile: своя строка users (scope id=actor), Pro нигде (TRIP-400)
  user_place:            ['self'],            // place + place/delete: свой user_custom_visits (scope user_id=actor), Pro нигде (TRIP-402)

  // ── owner: создатель трипа, проверка руками по trips.created_by ──
  deleteTrip:            'owner',       // удалить трип
  createStripeCheckout:  'owner',       // pro_trip покупает только владелец

  // ── self: своя строка / свой аккаунт ──
  createBillingPortal:   'self',
  deleteMyAccount:       'self',
  getActiveTrips:        'self',
  getMe:                 'self',        // читает свою строку users по актору из JWT (TRIP-400)
  getTravelStats:        'self',        // общий ридер статов (статистика+главная) по актору из JWT (TRIP-402, ярус A)
  getTrips:              'self',        // композит карточек главной по актору из JWT (TRIP-403, ярус B)
  getUserPlan:           'self',
  respondTripInvite:     'self',        // приглашение адресовано вызывающему
  telegramGetMyIntegrations: 'self',

  // ── auth: любой залогиненный, трип не при чём ──
  geoLocationiq:         'auth',        // геокодер, кэш общий
  getFxRates:            'auth',
  getStripePrices:       'auth',        // витрина каталога
  planTripWithAi:        'auth',        // Pro-гейта нет — продуктовое решение, TRIP-32
  stay22Accommodations:  'auth',
  viatorActivities:      'auth',

  // ── token: владение секретом в запросе ──
  getPublicTrip:         'token',       // tripId + share_token, без аутентификации
  redeemTripInviteLink:  'token',       // залогинен + валидный invite-токен
  stripe_webhook:        'token',       // подпись Stripe в заголовке

  // ── n8n: Bearer N8N_SECRET, сервер-сервер ──
  aiGate:                'n8n',
  getPendingReminders:   'n8n',
  getTripById:           'n8n',
  getTripByTelegramChatId: 'n8n',
  triplanioAiReply:      'n8n',

  // ── public: без аутентификации по замыслу, держится rate-limit ──
  requestPasswordReset:  'public',
  signupPrecheck:        'public',
};
