// trip-route — единая дверь записи структуры маршрута (TRIP-406, эпик TRIP-374).
//
// ПЯТЫЙ домен за швом: ОДИН писатель на `city_visits` (live-edit). Та же тонкая
// функция, что trip-booking/trip-budget, без единой правки логики `mutate.ts`.
// Действие — сегмент пути:
//   /trip-route/city/add · /trip-route/city/remove · /trip-route/city/reorder
//   /trip-route/city/nights · /trip-route/start-date
// Все пять — op:'rpc' (add_city/remove_city/reorder_cities/set_city_nights/
// set_trip_start_date), тела с явным p_actor, авторизация editor — только в шве.
// Своей логики здесь НЕТ — она в `_shared/mutate.ts` + `_shared/resources/tripRoute.ts`.
//
// Права (спецификация): всё = editor (роль-гейт `isCallerEditor`). Pro НИГДЕ
// (редактирование маршрута не за Pro — как booking). `verify_jwt=true` дефолтом
// (аутентифицируется через getRequestUser) — записи в config.toml не нужно.
import { withHandler } from '../_shared/http.ts';
import { mutate } from '../_shared/mutate.ts';

Deno.serve(withHandler('trip-route', (req, corsHeaders) =>
  mutate({ req, slug: 'trip-route', corsHeaders })));
