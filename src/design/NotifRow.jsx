// @ts-check
import React from 'react';
import { Avatar } from './index.jsx';
import { Tile } from './Tile.jsx';
import { Icon } from './icons.jsx';

// ----- NotifRow ----- (редизайн уведомлений — канон-объект строки инбокса)
// ОДНА строка на все типы событий и обе поверхности (поповер колокольчика +
// экран «Входящие»). Схлопывает две приватные копии — `.brow` (поповер) и
// `.nrow` (экран) — в один компонент; варианты (`unread`/`compact`) — пропами.
//
// ★ ПРЕЗЕНТАЦИОННЫЙ: бизнес-маппинг (тип→глиф, sender→аватар, i18n-текст) живёт в
// `notifView.buildNotifView` и приезжает готовыми слотами. Строка только рисует.
//
// ★ ГЛИФ — ДЕСКРИПТОР, рендерится примитивами ДС: `avatar` → <Avatar> (нет фото →
// инициалы+градиент, удалённый → «Удалённый аккаунт» — ровно как везде); `tile` →
// <Tile> с тоном; `pro` → золотой градиент. Своего аватаро-плейсхолдера нет.
//
// ★ ТЕКСТ — КАНОН типографики: заголовок `.t-label`, сообщение `.t-support`
// (вторичная строка при титле — новый канон, носитель №1 = уведомления), время
// `.t-meta`. `.notif__*` несут ТОЛЬКО раскладку (grid-area/цвет-роль/отступ).

// Дескриптор глифа из `notifView.notifGlyph`. `mode` держим строкой (в JS-спеке
// под `@ts-check` литерал не выводится); сужаем по значению при рендере ниже.
/** @typedef {{ mode: string, name?: string, photo?: string, deleted?: boolean, icon?: string, tone?: string }} NotifGlyph */

// Размер глифа берём ступенями самих примитивов (не переопределяя их): обычная
// строка — аватар `lg` (36) / плитка дефолт (34); компакт-поповер — аватар дефолт
// (28) / плитка `sm` (28). PRO — свой элемент, размер в CSS.
/** @param {{ glyph?: NotifGlyph, compact?: boolean }} p */
function NotifGlyphEl({ glyph, compact }) {
  if (!glyph) return null;
  if (glyph.mode === 'avatar') {
    return <Avatar size={compact ? undefined : 'lg'} name={glyph.name} photo={glyph.photo} deleted={glyph.deleted} className="notif__ava" />;
  }
  if (glyph.mode === 'pro') {
    return <span className="notif__ava notif__ava--pro"><Icon name="star" size={compact ? 16 : 18} /></span>;
  }
  // tone валиден только как TileTone; спека notifGlyph кладёт корректный литерал.
  return <Tile icon={glyph.icon} tone={/** @type {any} */ (glyph.tone)} size={compact ? 'sm' : undefined} className="notif__ava" />;
}

/**
 * @param {{
 *   glyph?: NotifGlyph,
 *   title?: any,
 *   message?: any,
 *   time?: any,
 *   unread?: boolean,
 *   compact?: boolean,
 *   actions?: any,
 *   onClick?: (e: any) => void,
 *   className?: string,
 * }} p
 */
export function NotifRow({ glyph, title, message, time, unread, compact, actions, onClick, className = '' }) {
  return (
    <div
      className={[
        'notif',
        unread && 'notif--unread',
        compact && 'notif--compact',
        onClick && 'notif--link',
        className,
      ].filter(Boolean).join(' ')}
      onClick={onClick}
    >
      <NotifGlyphEl glyph={glyph} compact={compact} />
      <div className="notif__title t-label">{title}</div>
      {message ? <div className="notif__msg t-support">{message}</div> : null}
      {time ? <div className="notif__time t-meta">{time}</div> : null}
      {actions ? <div className="notif__act">{actions}</div> : null}
    </div>
  );
}
NotifRow.displayName = 'NotifRow';
