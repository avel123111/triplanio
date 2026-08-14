// trip-owner — действия только владельца трипа за единой дверью (TRIP-416).
//
// Гейт owner (trips.created_by === actor), удаляет `trips` по скоупу
// (op:'delete'+targetBy:'scope'); дочерние — ON DELETE CASCADE. Действие —
// сегмент пути: /trip-owner/delete. Внешняя побочка (telegram/storage) —
// best-effort afterWrite. Логика — в `_shared/mutate.ts` +
// `_shared/resources/tripOwner.ts`.
// `verify_jwt=true` дефолтом (аутентификация через getRequestUser).
import { withHandler } from '../_shared/http.ts';
import { mutate } from '../_shared/mutate.ts';

Deno.serve(withHandler('trip-owner', (req, corsHeaders) =>
  mutate({ req, slug: 'trip-owner', corsHeaders })));
