// trip-member — единая дверь управления участниками (TRIP-409, эпик TRIP-374).
//
// Ось авторизации ОДНА: editor (создатель/активный админ). Действия — сегмент пути:
//   /trip-member/invite · /trip-member/add-offline · /trip-member/resend
//   /trip-member/role · /trip-member/remove
// Своей логики здесь НЕТ — она в `_shared/mutate.ts` + `_shared/resources/tripMember.ts`
// (+ побочки в `_shared/mutateEffects.ts`). Row-self-действия (leave/respond) —
// в отдельной функции `trip-member-self` (гейт row-self, не editor).
// `verify_jwt=true` дефолтом (аутентификация через getRequestUser) — записи в
// config.toml не нужно.
import { withHandler } from '../_shared/http.ts';
import { mutate } from '../_shared/mutate.ts';

Deno.serve(withHandler('trip-member', (req, corsHeaders) =>
  mutate({ req, slug: 'trip-member', corsHeaders })));
