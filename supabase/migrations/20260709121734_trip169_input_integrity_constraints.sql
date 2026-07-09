-- TRIP-169 — Слой целостности ввода в БД (форматный defense-in-depth).
--
-- Единственный слой, покрывающий сразу все три пути записи с фронта (прямой
-- PostgREST CRUD + RPC + edge): инвариант формы живёт в самой БД, а не в
-- edge-гейте, который доминирующий прямой CRUD обходит. Enum'ы уже закрыты
-- CHECK'ами (baseline). Здесь добиваем недостающее: кэпы длины строк и
-- неотрицательность чисел. Нарушение отдаётся PostgREST как 400 (23514), а не 500.
--
-- Кэпы выставлены заведомо выше реальных данных (замер dev+prod на 2026-07-09:
-- максимум пользовательской строки — cover_image_url=532 < 2048; отрицательных
-- чисел нет; 63 нулевых budget_expenses.original_amount — легитимный синк из
-- броней, поэтому число проверяется на `>= 0`, а не `> 0`).
--
-- Все проверки метаданные-only: не переписывают строки, откат = DROP CONSTRAINT.

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Домены «safe by construction» для БУДУЩИХ пользовательских колонок.
--    Новая text-колонка объявляется этим типом → кэп наследуется по типу, а не
--    по памяти разработчика. Существующие колонки не конвертируем (вью-зависимости);
--    им ниже даются эквивалентные CHECK'и. CI-линт (check-column-caps) требует,
--    чтобы новые пользовательские text-колонки использовали домен или char_length.
create domain public.short_text as text check (char_length(value) <= 300);
create domain public.long_text  as text check (char_length(value) <= 10000);
create domain public.url_text   as text check (char_length(value) <= 2048);

comment on domain public.short_text is 'Пользовательская короткая строка (имена/заголовки), кэп 300. TRIP-169.';
comment on domain public.long_text  is 'Пользовательский длинный текст (заметки/описания/адреса), кэп 10000. TRIP-169.';
comment on domain public.url_text   is 'URL/ссылка от пользователя, кэп 2048. TRIP-169.';

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Кэпы длины на существующие пользовательские строки.

-- 1a. Короткие (<= 300): имена, заголовки, коды, референсы.
alter table public.trips             add constraint trips_title_len            check (char_length(title) <= 300);
alter table public.trips             add constraint trips_share_token_len      check (share_token is null or char_length(share_token) <= 300);
alter table public.city_visits       add constraint cv_country_len             check (country is null or char_length(country) <= 300);
alter table public.city_visits       add constraint cv_timezone_len            check (timezone is null or char_length(timezone) <= 300);
alter table public.city_visits       add constraint cv_external_city_id_len    check (external_city_id is null or char_length(external_city_id) <= 300);
alter table public.city_visits       add constraint cv_city_name_en_len        check (city_name_en is null or char_length(city_name_en) <= 300);
alter table public.budget_categories add constraint bc_name_len                check (char_length(name) <= 300);
alter table public.budget_categories add constraint bc_icon_len                check (icon is null or char_length(icon) <= 300);
alter table public.budget_categories add constraint bc_color_len               check (color is null or char_length(color) <= 300);
alter table public.budget_expenses   add constraint be_title_len               check (char_length(title) <= 300);
alter table public.budget_expenses   add constraint be_city_name_len           check (city_name is null or char_length(city_name) <= 300);
alter table public.hotel_stays       add constraint hs_name_len                check (char_length(name) <= 300);
alter table public.hotel_stays       add constraint hs_booking_ref_len         check (booking_reference is null or char_length(booking_reference) <= 300);
alter table public.hotel_stays       add constraint hs_phone_len               check (phone is null or char_length(phone) <= 300);
alter table public.transfers         add constraint tr_carrier_len             check (carrier is null or char_length(carrier) <= 300);
alter table public.transfers         add constraint tr_booking_ref_len         check (booking_reference is null or char_length(booking_reference) <= 300);
alter table public.transfers         add constraint tr_flight_number_len       check (flight_number is null or char_length(flight_number) <= 300);
alter table public.trip_documents    add constraint td_title_len               check (char_length(title) <= 300);
alter table public.trip_documents    add constraint td_file_name_len           check (file_name is null or char_length(file_name) <= 300);
alter table public.trip_documents    add constraint td_created_by_name_len     check (created_by_name is null or char_length(created_by_name) <= 300);
alter table public.trip_services     add constraint ts_name_len                check (char_length(name) <= 300);
alter table public.activities        add constraint act_title_len              check (char_length(title) <= 300);
alter table public.trip_members      add constraint tm_full_name_len           check (user_full_name is null or char_length(user_full_name) <= 300);
alter table public.users             add constraint users_full_name_len        check (full_name is null or char_length(full_name) <= 300);
alter table public.notifications     add constraint notif_title_len            check (title is null or char_length(title) <= 300);

-- 1b. Длинные (<= 10000): заметки, описания, адреса, сообщения.
alter table public.trips             add constraint trips_description_len      check (description is null or char_length(description) <= 10000);
alter table public.trips             add constraint trips_notes_len           check (notes is null or char_length(notes) <= 10000);
alter table public.city_visits       add constraint cv_notes_len              check (notes is null or char_length(notes) <= 10000);
alter table public.budget_expenses   add constraint be_notes_len              check (notes is null or char_length(notes) <= 10000);
alter table public.hotel_stays       add constraint hs_address_len            check (address is null or char_length(address) <= 10000);
alter table public.hotel_stays       add constraint hs_notes_len              check (notes is null or char_length(notes) <= 10000);
alter table public.transfers         add constraint tr_from_address_len       check (from_address is null or char_length(from_address) <= 10000);
alter table public.transfers         add constraint tr_to_address_len         check (to_address is null or char_length(to_address) <= 10000);
alter table public.transfers         add constraint tr_notes_len              check (notes is null or char_length(notes) <= 10000);
alter table public.trip_documents    add constraint td_notes_len              check (notes is null or char_length(notes) <= 10000);
alter table public.activities        add constraint act_location_address_len  check (location_address is null or char_length(location_address) <= 10000);
alter table public.activities        add constraint act_notes_len             check (notes is null or char_length(notes) <= 10000);
alter table public.notifications     add constraint notif_message_len         check (message is null or char_length(message) <= 10000);

-- 1c. URL (<= 2048).
alter table public.trips             add constraint trips_cover_url_len        check (cover_image_url is null or char_length(cover_image_url) <= 2048);
alter table public.hotel_stays       add constraint hs_booking_url_len         check (booking_url is null or char_length(booking_url) <= 2048);
alter table public.transfers         add constraint tr_booking_url_len         check (booking_url is null or char_length(booking_url) <= 2048);
alter table public.trip_documents    add constraint td_link_url_len            check (link_url is null or char_length(link_url) <= 2048);
alter table public.trip_documents    add constraint td_file_url_len            check (file_url is null or char_length(file_url) <= 2048);
alter table public.users             add constraint users_avatar_url_len       check (avatar_url is null or char_length(avatar_url) <= 2048);
alter table public.notifications     add constraint notif_action_url_len       check (action_url is null or char_length(action_url) <= 2048);

-- 1d. Email (<= 320, RFC 5321) и коды (валюта <= 8, страна <= 8).
alter table public.users             add constraint users_email_len           check (char_length(email) <= 320);
alter table public.trip_members      add constraint tm_invite_email_len       check (invite_email is null or char_length(invite_email) <= 320);
alter table public.hotel_stays       add constraint hs_email_len              check (email is null or char_length(email) <= 320);
alter table public.hotel_stays       add constraint hs_currency_len           check (char_length(currency) <= 8);
alter table public.activities        add constraint act_currency_len          check (char_length(currency) <= 8);
alter table public.transfers         add constraint tr_currency_len           check (char_length(currency) <= 8);
alter table public.trip_services     add constraint ts_currency_len           check (char_length(currency) <= 8);
alter table public.trip_budgets      add constraint tb_currency_len           check (char_length(currency) <= 8);
alter table public.budget_expenses   add constraint be_orig_currency_len      check (original_currency is null or char_length(original_currency) <= 8);
alter table public.city_visits       add constraint cv_country_code_len       check (country_code is null or char_length(country_code) <= 8);
alter table public.user_custom_visits add constraint ucv_country_code_len     check (country_code is null or char_length(country_code) <= 8);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Неотрицательность чисел (цены/суммы/порядки). Все nullable → `null OR >= 0`.
--    `>= 0`, а не `> 0`: 0 легитимен (бесплатный отель/актив, синк-трата из брони
--    с нулевой ценой — 63 таких на prod). Режем только заведомый мусор (< 0).
alter table public.activities        add constraint act_price_nonneg          check (price is null or price >= 0);
alter table public.hotel_stays       add constraint hs_price_nonneg           check (price is null or price >= 0);
alter table public.transfers         add constraint tr_price_nonneg           check (price is null or price >= 0);
alter table public.trip_services     add constraint ts_price_nonneg           check (price is null or price >= 0);
alter table public.budget_expenses   add constraint be_amount_nonneg          check (original_amount is null or original_amount >= 0);
alter table public.city_visits       add constraint cv_position_nonneg        check (position is null or position >= 0);
alter table public.budget_categories add constraint bc_order_index_nonneg     check (order_index is null or order_index >= 0);
