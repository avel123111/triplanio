// trip — единая дверь создания трипа с маршрутом (TRIP-406, эпик TRIP-374).
//
// ОДНО действие в ПУТИ — `/trip/create` → op:'rpc' create_trip_with_route
// (INSERT trips + bulk city_visits + recompute, атомарно). Своей логики здесь
// НЕТ — вся в `_shared/mutate.ts` + `_shared/resources/trip.ts`. Право
// (спецификация): `trip_quota` (лимит free/Pro → честный 402 TRIP_LIMIT_REACHED);
// владелец = актор из JWT (scope=actor). Pro нигде. `verify_jwt=true` дефолтом
// (аутентифицируется через getRequestUser) — записи в config.toml не нужно.
import { withHandler } from '../_shared/http.ts';
import { mutate } from '../_shared/mutate.ts';

Deno.serve(withHandler('trip', (req, corsHeaders) =>
  mutate({ req, slug: 'trip', corsHeaders })));
