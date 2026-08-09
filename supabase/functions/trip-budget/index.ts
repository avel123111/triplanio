// trip-budget — единая дверь записи бюджета (TRIP-394, Ф2 эпика TRIP-374).
//
// ПЕРВАЯ функция репо с действием в ПУТИ, а не в теле: `/trip-budget/expense`,
// `/trip-budget/expense/delete`, `/trip-budget/category`, `/trip-budget/settings`.
// Своей логики здесь НЕТ — вся она в шве `_shared/mutate.ts` + спецификации
// `_shared/resources/tripBudget.ts`. Это и есть проверка блока 2: второй домен
// (trip-document) добавится такой же тонкой функцией, не трогая шов.
//
// Контракт прав (спецификация): ручная трата/категория/курсы = editor + Pro
// (иначе 402 x-sentry-skip); автотраты сюда не ходят (их пишет триггер
// sync_budget_expense из брони); валюта — ресурс trip (updateTripSettings).
import { withHandler } from '../_shared/http.ts';
import { mutate } from '../_shared/mutate.ts';

Deno.serve(withHandler('trip-budget', (req, corsHeaders) =>
  mutate({ req, slug: 'trip-budget', corsHeaders })));
