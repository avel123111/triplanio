// trip-member-self — действия участника над СВОЕЙ строкой членства (TRIP-409).
//
// Отделён от `trip-member` осознанно: гейт `requires:[]`, авторизация = row-self
// через `guardRow` (роль трипа не при чём; «editor ИЛИ self» невыразим —
// `requires` склеивается через И). Действия — сегмент пути:
//   /trip-member-self/leave · /trip-member-self/respond
// Инвариант №7 (`findUnguardedRowSelf`) форсит loadTarget+guardRow у обоих.
// Логика — в `_shared/mutate.ts` + `_shared/resources/tripMemberSelf.ts`.
// `verify_jwt=true` дефолтом (аутентификация через getRequestUser).
import { withHandler } from '../_shared/http.ts';
import { mutate } from '../_shared/mutate.ts';

Deno.serve(withHandler('trip-member-self', (req, corsHeaders) =>
  mutate({ req, slug: 'trip-member-self', corsHeaders })));
