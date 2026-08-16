// @ts-check
import React, { createContext, useContext, useMemo } from 'react';
import { resolveMyStep, clearsStep } from '@/lib/tripStep';

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
// Это НЕ новое правило, а транспорт уже существующего: значения — из
// `resolveMyStep`/`clearsStep`. Рукописный вывод права мимо лестницы ловит
// гард 2z (`check-role-gate`).

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
 * @param {{ members?: any[], trip?: any, user?: any, children?: any }} p
 */
export function TripAccessProvider({ members = [], trip = null, user = null, children }) {
  const value = useMemo(() => {
    const step = resolveMyStep(members, trip, user);
    return {
      step,
      canEdit: clearsStep(step, 'editor'),
      isOwner: clearsStep(step, 'owner'),
      clears: (/** @type {'owner'|'editor'|'participant'} */ need) => clearsStep(step, need),
    };
  }, [members, trip, user]);
  return <TripAccessCtx.Provider value={value}>{children}</TripAccessCtx.Provider>;
}

/** Право текущего пользователя на трипе. @returns {TripAccess} */
export function useTripAccess() {
  return useContext(TripAccessCtx);
}
