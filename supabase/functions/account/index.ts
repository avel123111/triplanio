// account — единая дверь записи профиля/настроек своей строки users
// (TRIP-400, домен аккаунта, эпик TRIP-374).
//
// Первый self-ресурс за швом: действие в ПУТИ — `/account/profile`. Своей логики
// здесь НЕТ — вся в шве `_shared/mutate.ts` + спецификации
// `_shared/resources/account.ts`. Право (спецификация): `self` (строкой владеет
// актор из JWT). Pro нигде. `verify_jwt=true` дефолтом (функция аутентифицируется
// через getRequestUser, как trip-budget/trip-document) — записи в config.toml не
// нужно.
import { withHandler } from '../_shared/http.ts';
import { mutate } from '../_shared/mutate.ts';

Deno.serve(withHandler('account', (req, corsHeaders) =>
  mutate({ req, slug: 'account', corsHeaders })));
