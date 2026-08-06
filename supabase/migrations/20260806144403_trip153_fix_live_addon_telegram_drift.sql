-- TRIP-153 (4/4): разовая починка ЖИВОГО расхождения. Данные, не поведение.
--
-- Замерено на проде 2026-08-06 перед правкой:
--   trip 49a1de05 — владелец subscription_status='free', is_pro_trip=false,
--   то есть трип НЕ Pro, при этом details.addons.telegram_assistant=true и в
--   trip_telegram_integrations две живые строки.
--
-- Почему это не косметика: aiGate НЕ проверяет Pro сам — он держится на
-- инварианте «есть привязка ⇒ трип Pro» (это записано в его шапке) и пускает
-- сообщение в Gemini по одному лишь факту привязки. Сломанный инвариант =
-- бесплатный ИИ через бота. Механизм отката (revoke_*_pro_addons +
-- disconnectTripTelegram) существует и корректен, но зовётся только на запись
-- вебхука; потеря Pro ПО ВРЕМЕНИ записи не порождает, поэтому звать его было
-- некому — ровно та дыра, ради которой заводится сверка.
--
-- Сверка (миграция 3/4) вводится в режиме report и сама этого НЕ чинит, а PR2,
-- где DELETE привязки уезжает внутрь revoke_*_pro_addons, приедет позже. Ждать
-- их незачем: состояние уже неверное, а починка данных отделима от починки
-- механизма и обратима ре-привязкой из UI.
--
-- Флаги гасим ВЫЗОВОМ revoke_user_pro_addons, а не своим UPDATE: у неё уже есть
-- и предикат «трип не Pro», и набор Pro-аддонов. Своя копия jsonb_set здесь
-- была бы третьей и разъехалась бы с ней при первом же изменении списка
-- аддонов.

do $$
declare
  v_user     record;
  v_flags    integer := 0;
  v_bindings integer := 0;
  v_n        integer;
begin
  -- 1. Флаги аддонов на всех не-Pro трипах — через существующий шов.
  for v_user in select id from public.users loop
    select count(*) into v_n from public.revoke_user_pro_addons(v_user.id);
    v_flags := v_flags + v_n;
  end loop;

  -- 2. Живые привязки Telegram на не-Pro трипах. Семантика та же, что у
  --    disconnectTripTelegram: удаление скоупится по trip_id, поэтому общий чат,
  --    привязанный к нескольким трипам, сохраняет привязки к остальным.
  --    Джойн к trips не нужен: trip_id NOT NULL + FK ON DELETE CASCADE, то есть
  --    трип у каждой строки заведомо существует.
  delete from public.trip_telegram_integrations i
   where not public.is_trip_pro(i.trip_id);
  get diagnostics v_bindings = row_count;

  raise notice 'TRIP-153 cleanup: % trip(s) matched addon revoke, % telegram binding(s) removed', v_flags, v_bindings;
end $$;
