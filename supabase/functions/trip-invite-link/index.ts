// trip-invite-link — общая ссылка-приглашение за единой дверью (TRIP-409).
//
// Гейт editor (как trip-member), но пишет ДРУГУЮ таблицу (trip_invite_links) →
// свой ресурс. Действие — сегмент пути: /trip-invite-link/create.
// Логика — в `_shared/mutate.ts` + `_shared/resources/tripInviteLink.ts`.
// `verify_jwt=true` дефолтом (аутентификация через getRequestUser).
import { withHandler } from '../_shared/http.ts';
import { mutate } from '../_shared/mutate.ts';

Deno.serve(withHandler('trip-invite-link', (req, corsHeaders) =>
  mutate({ req, slug: 'trip-invite-link', corsHeaders })));
