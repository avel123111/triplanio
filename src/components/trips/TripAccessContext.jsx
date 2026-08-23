// @ts-check
import React, { createContext, useContext, useMemo } from 'react';
import { clearsStep } from '@/lib/tripStep';

// ЕДИНЫЙ доступ к праву на трипе для ВСЕГО поддерева (TRIP-274 Ф2.2).
//
// Правило одно — лестница `src/lib/tripStep.js` (зеркало сервера). Раньше
// ступень считалась в `TripView` и раздавалась булевыми ПРОПАМИ (`canEdit`/
// `canManage`/`isOwner`) — это доставало до линз, но не до глубоких диалогов
// (`EventEditDialog`/`ForkPartnerModal`), которые роль-слепые. Два способа узнать
// право (пропы + новый контекст) = дубль механизма. Провайдер убирает дубль:
// ступень считается ОДИН раз здесь, любой компонент на любой глубине читает
// `useTripAccess()` — линза, панель, диалог, кнопка. Пропов права больше нет.
//
// Это НЕ новое правило, а транспорт уже существующего: ступень приходит ГОТОВОЙ
// из ответа `getTripDetails` (поле `myStep` — та самая, что решила серверный
// access-check), здесь она только читается лестницей `clearsStep`. Рукописный
// вывод права мимо лестницы ловит гард 2z (`check-role-gate`).
//
// ★ Почему ступень БОЛЬШЕ НЕ СЧИТАЕТСЯ здесь. Считалась она из `members`, а те
// приезжают вторым сетевым кругом — поэтому право «догружалось» отдельно от
// трипа, и меню собиралось в два приёма (у не-владельца сначала без Структуры,
// Участников и «Поделиться»). Сервер знает ответ на первом же круге и теперь его
// отдаёт. Побочно исчезла и четвёртая копия правила о ролях: FE больше не
// выводит ступень из ролей, а значит ей не с чем разъехаться.

/** @typedef {'owner'|'editor'|'participant'|null} TripStep */
/**
 * @typedef {{
 *   step: TripStep,
 *   canEdit: boolean,   // ступень editor — правит контент (эвенты/сервисы/бюджет/доки/настройки/участники)
 *   isOwner: boolean,   // ступень owner — удалить трип, апселл upgrade/info
 *   clears: (need: 'owner'|'editor'|'participant') => boolean,
 * }} TripAccess
 */

// Дефолт fail-closed: вне провайдера прав НЕТ. Промах провайдера = read-only
// для всех (видно на первом же экране), а не молчаливый доступ.
/** @type {TripAccess} */
const NO_ACCESS = { step: null, canEdit: false, isOwner: false, clears: () => false };

const TripAccessCtx = createContext(NO_ACCESS);

/**
 * `step` — из ответа read-двери. `null` = ступень ещё не известна (ответ не
 * приехал) ИЛИ её нет: обе ситуации fail-closed, прав не даём.
 * @param {{ step?: TripStep, children?: any }} p
 */
export function TripAccessProvider({ step = null, children }) {
  const value = useMemo(() => {
    return {
      step,
      canEdit: clearsStep(step, 'editor'),
      isOwner: clearsStep(step, 'owner'),
      clears: (/** @type {'owner'|'editor'|'participant'} */ need) => clearsStep(step, need),
    };
  }, [step]);
  return <TripAccessCtx.Provider value={value}>{children}</TripAccessCtx.Provider>;
}

/** Право текущего пользователя на трипе. @returns {TripAccess} */
export function useTripAccess() {
  return useContext(TripAccessCtx);
}
