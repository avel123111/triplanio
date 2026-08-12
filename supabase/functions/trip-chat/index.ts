// trip-chat — единая дверь записи сообщения в чат (TRIP-408, эпик TRIP-374).
//
// ШЕСТОЙ домен за швом и ПОСЛЕДНЯЯ клиентская мутация репо (`rpcMutating 1→0`).
// Та же тонкая функция, что trip-route/trip-booking, без единой правки логики
// `mutate.ts`. Действие — сегмент пути: /trip-chat/send.
//
// Права (спецификация `_shared/resources/tripChat.ts`): `['participant','pro']` —
// viewer проходит (чат коллаборативный), участник-не-Pro → 402 (чат = Pro-аддон;
// закрывает дыру энфорса). Авторизация — только в шве. `verify_jwt=true` дефолтом
// (аутентификация через getRequestUser) — записи в config.toml не нужно.
import { withHandler } from '../_shared/http.ts';
import { mutate } from '../_shared/mutate.ts';

Deno.serve(withHandler('trip-chat', (req, corsHeaders) =>
  mutate({ req, slug: 'trip-chat', corsHeaders })));
