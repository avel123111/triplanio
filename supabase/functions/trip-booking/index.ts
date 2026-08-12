// trip-booking — единая дверь записи броней (TRIP-405, эпик TRIP-374).
//
// ЧЕТВЁРТЫЙ домен за швом: ОДИН писатель на 4 booking-таблицы. Та же тонкая
// функция, что trip-budget/trip-document, без единой правки логики `mutate.ts`.
// Действие — сегмент пути:
//   /trip-booking/hotel · /trip-booking/hotel/delete
//   /trip-booking/transfer · /trip-booking/transfer/delete
//   /trip-booking/activity · /trip-booking/activity/delete
//   /trip-booking/service · /trip-booking/service/delete
//   /trip-booking/transfer-layover   (op:'rpc' → add_layover_transfer)
// Своей логики здесь НЕТ — она в шве `_shared/mutate.ts` + спецификации
// `_shared/resources/tripBooking.ts`.
//
// Права (спецификация): всё = editor (роль-гейт `_can_edit_trip`). Pro НИГДЕ
// (Pro-гейт AI-парсера — отдельная фича, не эта дверь). `verify_jwt=true`
// дефолтом (аутентифицируется через getRequestUser) — записи в config.toml нет.
import { withHandler } from '../_shared/http.ts';
import { mutate } from '../_shared/mutate.ts';

Deno.serve(withHandler('trip-booking', (req, corsHeaders) =>
  mutate({ req, slug: 'trip-booking', corsHeaders })));
