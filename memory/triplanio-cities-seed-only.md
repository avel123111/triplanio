---
name: triplanio-cities-seed-only
description: "cities = курируемый seed/ETL-only справочник — рантайм НИКОГДА не пишет; set_city_id resolve-only, learn_city дропнут (TRIP-135)"
metadata:
  node_type: memory
  type: project
---

★РЕАЛИЗОВАНО на ветке (PR #227 в dev) 2026-06-28. Таблица `cities` — **курируемая seed/ETL-only размерность; рантайм-флоу в неё НИКОГДА не пишут**. Растёт только сидами/ETL (source: iata-seed ~3507, viator ~1334, getyourguide 3; locationiq-строки больше не добавляются).

**Баг, который это закрыло (TRIP-135):** сохранение AI/ручного трипа падало с `new row violates row-level security policy for table "cities"`. Триггер `set_city_id` (BEFORE INSERT/UPDATE на `city_visits`, **SECURITY INVOKER**) на промахе резолва делал `INSERT INTO cities (... 'manual')` под ролью вызывающего; у `cities` RLS только SELECT-политика (INSERT-политики нет) → insert всегда падал и ронял всю вставку `city_visits` (→ осиротевшие пустые трипы). Он НИКОГДА не вставил ни строки (0 строк `source='manual'` на prod+dev). Срабатывает только для города >30 км от любой строки справочника (resolve_city_id, бокс 0.3°/30км) → выглядело «через раз» (падал на изолированных городах, напр. кольцо по Исландии).

**Было ДВА дублирующих рантайм-писателя `cities`** (оба в planner-флоу): `set_city_id`→'manual' (падал) и `learn_city` (SECURITY DEFINER, fire-and-forget из `geoLocationiq.resolveCities`)→'locationiq' (работал, ~113 dev/30 prod). Строки learn_city без `viator_dest_id`/iata → активностей/ссылок не дают, только стабильный city_id.

**Фикс:**
1. `set_city_id` → **resolve-only**: при попадании ставит `city_id` из справочника, при промахе оставляет `city_id` NULL, БЕЗ insert. (NULL — штатное состояние: FK `city_id→cities(id)` nullable, ~8/397 визитов уже NULL; читатели `city_id` — только Viator-активности `src/lib/viator.js`/`buildBookingPlatforms` — graceful-empty.)
2. `learn_city` **дропнут** (`DROP FUNCTION`) + выпилен его вызов из `geoLocationiq` (хелпер `bestCoords` тоже удалён).
3. `resolve_cities_local` (directory-first **чтение**) НЕ тронут — только читает/ищет.

Миграция `supabase/migrations/20260628010000_trip135_cities_seed_only.sql` (deploy через CI/CD на мердж в dev→main). **Why:** один инвариант «cities seed-only» + устранение дубля писателей (правило reuse/унификации). **How to apply:** новый город НЕ создаём из рантайма; нужен в справочнике — добавлять сидом/ETL. Связано с [[triplanio-viator-cities-integration]], [[triplanio-ai-city-resolve-directory-en]], [[triplanio-pro-status-hook]] (тот же PR).
