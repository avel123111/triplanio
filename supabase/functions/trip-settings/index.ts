// trip-settings — настройки трипа за единой дверью (TRIP-416).
//
// Гейт editor (создатель/админ), пишет `trips` через RPC update_trip_settings.
// Действие — сегмент пути: /trip-settings/settings.
// Логика — в `_shared/mutate.ts` + `_shared/resources/tripSettings.ts`.
// `verify_jwt=true` дефолтом (аутентификация через getRequestUser) — записи в
// config.toml не нужно.
import { withHandler } from '../_shared/http.ts';
import { mutate } from '../_shared/mutate.ts';

Deno.serve(withHandler('trip-settings', (req, corsHeaders) =>
  mutate({ req, slug: 'trip-settings', corsHeaders })));
