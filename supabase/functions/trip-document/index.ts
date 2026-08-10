// trip-document — единая дверь записи документов (TRIP-399, эпик TRIP-374).
//
// ВТОРОЙ домен за швом и ПРИЁМКА блока 2: та же тонкая функция, что trip-budget,
// без единой правки `_shared/mutate.ts`. Действие — сегмент пути:
// `/trip-document/doc` (create-only), `/trip-document/doc/delete`. Своей логики
// здесь НЕТ — она в шве `_shared/mutate.ts` + спецификации
// `_shared/resources/tripDocument.ts`.
//
// Права (спецификация): create/delete = editor; delete построчно (личный док —
// только автор). Pro нигде. `verify_jwt=true` дефолтом (функция аутентифицируется
// через getRequestUser, как trip-budget) — записи в config.toml не нужно.
import { withHandler } from '../_shared/http.ts';
import { mutate } from '../_shared/mutate.ts';

Deno.serve(withHandler('trip-document', (req, corsHeaders) =>
  mutate({ req, slug: 'trip-document', corsHeaders })));
