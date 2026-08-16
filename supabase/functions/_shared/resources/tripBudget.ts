/**
 * Ресурс `trip-budget` — ПЕРВЫЙ домен за единой дверью (TRIP-394, Ф2).
 *
 * Спецификация — ДАННЫЕ: шов (`../mutate.ts`) исполняет её одинаково для всех
 * ресурсов и не знает слова «бюджет». Файл import-free по той же причине, что и
 * `../mutateRules.ts`, — чтобы правило можно было запинить тестом.
 *
 * ★ КОНТРАКТ (решение Pavel 2026-08-09, шапка ТЗ TRIP-394). Он НЕ повторяет
 * сегодняшнее поведение, а чинит его: Pro-гейт бюджета сегодня ТОЛЬКО
 * клиентский (`BudgetLens` гейтит записи `readOnly` = роль, а Pro стоит на
 * оболочке в `TripView`), то есть прямым вызовом REST его обходили. Здесь он
 * серверный:
 *
 *   чтение (лента, виджет Обзора)      participant, БЕЗ Pro   — не тут, это getTripDetails
 *   ручная трата create/update/delete  editor + Pro
 *   категория create/update            editor + Pro   (delete НЕТ, см. ниже)
 *   курсы fx_overrides                 editor + Pro
 *   автотрата (source_kind ≠ manual)   вообще не через эту дверь — её пишет
 *                                      триггер `sync_budget_expense` из брони
 *   валюта трипа                       ресурс `trip` (updateTripSettings), без Pro
 *
 * ★★ УДАЛЕНИЯ КАТЕГОРИИ ЗДЕСЬ НЕТ — И ЭТО РЕШЕНИЕ, А НЕ ПРОБЕЛ. В продукте его
 * нет ни на клиенте, ни в edge (проверено), а `budget_expenses.category_id` —
 * NOT NULL с FK `ON DELETE CASCADE`: удаление категории МОЛЧА снесло бы все её
 * траты, включая синхронизированные из броней (вернуть их можно только правкой
 * самой брони). Заводить такую дверь «за компанию» нельзя.
 *
 * Кэпы ниже — зеркало CHECK живой схемы (замер dev 2026-08-09). Расходиться им
 * нельзя: то, что БД отвергнет как 500 с текстом Postgres, шов обязан отвергнуть
 * как внятный 400.
 */

import type { ResourceSpec } from '../mutateRules.ts';
import { forbid } from '../mutateRules.ts';

export const TRIP_BUDGET: ResourceSpec = {
  name: 'trip-budget',
  scope: { column: 'trip_id', from: 'tripId' },
  actions: {
    /** Ручная трата: вставка без id, правка по id. */
    expense: {
      op: 'upsert',
      table: 'budget_expenses',
      requires: ['editor', 'pro'],
      loadTarget: true,
      fields: {
        category_id: { type: 'uuid', required: true },
        title: { type: 'string', required: true, max: 300 },
        original_amount: { type: 'number', min: 0, nullable: true },
        original_currency: { type: 'string', max: 8, nullable: true },
        notes: { type: 'string', max: 10000, nullable: true },
        spent_on: { type: 'date', nullable: true },
        city_visit_id: { type: 'uuid', nullable: true },
        city_name: { type: 'string', max: 300, nullable: true },
      },
      // `source_kind`/`source_id` НЕ поля клиента: ручная дверь всегда рождает
      // ручную трату. Прислать `source_kind:'hotel'` и подделать автотрату нельзя.
      forcedOnInsert: { source_kind: 'manual', source_id: null, created_by: '@actor' },
      guardRow: (row) =>
        row.source_kind === 'manual' ? null : forbid(
          403,
          'EXPENSE_NOT_MANUAL',
          'This expense comes from a booking and is edited there',
        ),
    },

    'expense/delete': {
      op: 'delete',
      table: 'budget_expenses',
      requires: ['editor', 'pro'],
      loadTarget: true,
      guardRow: (row) =>
        row.source_kind === 'manual' ? null : forbid(
          403,
          'EXPENSE_NOT_MANUAL',
          'This expense comes from a booking and is removed there',
        ),
    },

    /** Категория трат: вставка без id, правка по id. */
    category: {
      op: 'upsert',
      table: 'budget_categories',
      requires: ['editor', 'pro'],
      loadTarget: true,
      fields: {
        name: { type: 'string', required: true, max: 300 },
        color: { type: 'string', max: 300, nullable: true },
        icon: { type: 'string', max: 300, nullable: true },
        // Только ОБНУЛЕНИЕ: переименованная сеяная категория отвязывается от
        // системного ключа (TRIP-230), но присвоить себе чужой ключ нельзя —
        // `sync_budget_expense` роутит по нему автотраты. Решает клиент, потому
        // что «переименовал» считается от ЛОКАЛИЗОВАННОЙ подписи
        // (`categoryDisplayName`), а языка зрителя сервер не знает.
        system_key: { type: 'string', clearOnly: true, nullable: true },
      },
      forcedOnInsert: { kind: 'custom', system_key: null, order_index: 99, created_by: '@actor' },
      guardRow: (row) =>
        row.kind === 'custom' ? null : forbid(
          403,
          'CATEGORY_SYSTEM',
          'System categories cannot be edited',
        ),
    },

    /**
     * Курсы трипа. Синглтон: строка адресуется скоупом, id не принимается.
     * Строку гарантирует `ensure_trip_budget` — она уже делает ровно этот
     * self-heal (вставка при отсутствии + посев категорий), зовётся триггером
     * создания трипа и исполнима ТОЛЬКО `service_role` (замер: anon/authenticated
     * — false). Писать `currency` руками здесь нельзя: на 69% трипов прода
     * `details.main_currency` = NULL, а колонка NOT NULL — RPC берёт
     * `coalesce(main_currency,'EUR')` и не промахивается.
     */
    settings: {
      op: 'upsert',
      table: 'trip_budgets',
      targetBy: 'scope',
      requires: ['editor', 'pro'],
      prepareRpc: 'ensure_trip_budget',
      fields: {
        fx_overrides: { type: 'json' },
      },
    },
  },
};
