// inbox — дверь записи флага `read` уведомлений (TRIP-408, эпик TRIP-374).
//
// Часть полного закрытия `notifications`: прямой клиентский UPDATE флага уходит
// за шов. Та же тонкая функция, что account/trip-route. Действия — сегмент пути:
//   /inbox/read       — одно уведомление по id
//   /inbox/read-all   — все непрочитанные актора
//
// Права (`_shared/resources/inbox.ts`): `['self']` — своя строка (scope
// user_id=actor). `verify_jwt=true` дефолтом (аутентификация через
// getRequestUser) — записи в config.toml не нужно.
import { withHandler } from '../_shared/http.ts';
import { mutate } from '../_shared/mutate.ts';

Deno.serve(withHandler('inbox', (req, corsHeaders) =>
  mutate({ req, slug: 'inbox', corsHeaders })));
