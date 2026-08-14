// trip-share — шеринг и копия трипа за единой дверью (TRIP-416).
//
// Гейт participant (зритель проходит осознанно). Действия — сегмент пути:
// /trip-share/share (find-or-create токена), /trip-share/copy (атомарная копия).
// Логика — в `_shared/mutate.ts` + `_shared/resources/tripShare.ts`.
// `verify_jwt=true` дефолтом (аутентификация через getRequestUser).
import { withHandler } from '../_shared/http.ts';
import { mutate } from '../_shared/mutate.ts';

Deno.serve(withHandler('trip-share', (req, corsHeaders) =>
  mutate({ req, slug: 'trip-share', corsHeaders })));
