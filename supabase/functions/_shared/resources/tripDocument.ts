/**
 * Ресурс `trip-document` — ВТОРОЙ домен за единой дверью (TRIP-399, эпик TRIP-374).
 *
 * Приёмка блока 2: домен проходит тем же швом (`../mutate.ts`) без единой правки
 * `mutate.ts`. Движок дорос ДВУМЯ генерик-возможностями (`op:'insert'`,
 * `FieldSpec.validate`), а доменная логика — здесь, в ДАННЫХ. Файл import-free
 * (кроме типов) по той же причине, что `../mutateRules.ts`: правило должно быть
 * запинено тестом без загрузки клиента БД.
 *
 * ★ КОНТРАКТ — ЗЕРКАЛО ЖИВОЙ RLS (замер dev 2026-08-10). Шов воспроизводит в TS
 * ровно то, что политики держали на `authenticated`:
 *
 *   чтение списка   participant; shared → всем, private → только автору
 *                   (`_can_access_trip_document`) — НЕ тут, это getTripDetails
 *   create          editor; `created_by` форсится = актор
 *   delete          editor + построчно: private ⇒ только автор, shared ⇒ любой editor
 *
 * ★★ РЕДАКТИРОВАНИЯ ДОКА С КЛИЕНТА НЕТ — И ЭТО РЕШЕНИЕ, А НЕ ПРОБЕЛ. В продукте
 * только insert + delete (проверено), поэтому действие create объявлено
 * `op:'insert'` (create-only): присланный id ИГНОРИРУЕТСЯ. `upsert` с чужим id
 * ушёл бы в UPDATE и правил бы чужую SHARED-строку (delete/update RLS пускает
 * shared любому editor) — регресс TRIP-118. Дверь редактирования «за компанию»
 * не заводим, как и удаление категории у бюджета.
 *
 * ★★★ ПОСТРОЧНОЕ ПРАВО — ПЕРВЫЙ такой домен. «private ⇒ только автор» зависит от
 * СОСТОЯНИЯ строки (`visibility`/`created_by`), а не от роли, → `guardRow` по уже
 * загруженной строке (handoff: «правило решается по строке → `guardRow`»). Тот
 * же слот, которым бюджет гейтит `source_kind`.
 *
 * Кэпы и форматы ниже — зеркало CHECK живой схемы. Расходиться нельзя: что БД
 * отвергнет как 500 с текстом Postgres, шов обязан отвергнуть как внятный 400.
 * `link_url ~* '^https?://'` и `documents.$[*].file_url` (антивзлом TRIP-281)
 * невыразимы `type/max/enum`, поэтому едут `validate`-хуком.
 */

import type { ResourceSpec } from '../mutateRules.ts';
import { bad, forbid, HTTP_URL, validateDocuments } from '../mutateRules.ts';

export const TRIP_DOCUMENT: ResourceSpec = {
  name: 'trip-document',
  scope: { column: 'trip_id', from: 'tripId' },
  actions: {
    /** Карточка документа: ТОЛЬКО вставка (create-only), правки дока нет. */
    doc: {
      op: 'insert',
      table: 'trip_documents',
      requires: ['editor'],
      fields: {
        title: { type: 'string', required: true, max: 300 },
        // Деф. 'shared' держит колонка БД — поле не обязательно; клиент всё равно
        // всегда шлёт выбор из диалога.
        visibility: { type: 'string', enum: ['shared', 'private'] },
        notes: { type: 'string', max: 10000, nullable: true },
        link_url: {
          type: 'string',
          max: 2048,
          nullable: true,
          validate: (v) => (typeof v === 'string' && HTTP_URL.test(v) ? null : bad(
            'Field "link_url" must be an http(s) URL',
          )),
        },
        documents: { type: 'array', nullable: true, validate: validateDocuments },
        // Снимок имени автора — переживает выход автора из трипа (его строка
        // trip_members/профиля исчезает), как chat_messages.user_full_name.
        created_by_name: { type: 'string', max: 300, nullable: true },
      },
      // Авторство ставит СЕРВЕР из JWT: клиент не выдаёт документ за чужой.
      forcedOnInsert: { created_by: '@actor' },
    },

    'doc/delete': {
      op: 'delete',
      table: 'trip_documents',
      requires: ['editor'],
      loadTarget: true,
      // Построчно: личный док удаляет только его автор; общий — любой редактор.
      // `actor` теперь ПОЛНЫЙ `{id,email}` (TRIP-409) — владение сверяем по `actor.id`.
      guardRow: (row, actor) =>
        row.visibility === 'private' && row.created_by !== actor.id
          ? forbid(403, 'DOC_PRIVATE_NOT_OWNER', 'A private document can be removed only by its owner')
          : null,
    },
  },
};
