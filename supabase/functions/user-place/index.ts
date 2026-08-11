// user-place — единая дверь записи ручных визитов user_custom_visits
// (TRIP-402, домен статистики, эпик TRIP-374).
//
// Действия в ПУТИ: `/user-place/place` (upsert), `/user-place/place/delete`.
// Своей логики здесь НЕТ — вся в шве `_shared/mutate.ts` + спецификации
// `_shared/resources/userPlace.ts`. Право (спецификация): `self` (строкой владеет
// актор из JWT; scope.column=user_id). Pro нигде. verify_jwt=true дефолтом
// (аутентификация через getRequestUser в шве, как account/trip-document) — записи
// в config.toml не нужно.
import { withHandler } from '../_shared/http.ts';
import { mutate } from '../_shared/mutate.ts';

Deno.serve(withHandler('user-place', (req, corsHeaders) =>
  mutate({ req, slug: 'user-place', corsHeaders })));
