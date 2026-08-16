// @ts-check
// Единый резолвер строки уведомления — ОДИН дом для попапа колокольчика и экрана
// «Входящие» (раньше `renderParams` жил копией в обоих). Здесь имя автора события
// становится ЖИВЫМ: оно берётся из `n.sender` (создатель `created_by`, резолв на
// сервере — getInbox), а не из снапшота в тексте. Так закрывается утечка «имя
// вварено в строку и переживает анонимизацию»; аватар редизайн возьмёт из того же
// `sender`. Снапшот в `i18n_params` (у строк-триггеров) остаётся тихим фолбэком.
import React from 'react';

// Render `text` but wrap occurrences of given values in styled <span>s.
// Used to bold the inviter name and emphasize the trip name in invite rows.
export function emphasize(text, parts = []) {
  if (text == null) return text;
  let nodes = [String(text)];
  parts.filter(p => p && p.value).forEach((p, pi) => {
    nodes = nodes.flatMap((node, ni) => {
      if (typeof node !== 'string') return [node];
      const segs = node.split(p.value);
      const out = [];
      segs.forEach((s, si) => {
        if (s) out.push(s);
        if (si < segs.length - 1) out.push(<span key={`e${pi}-${ni}-${si}`} style={p.style}>{p.value}</span>);
      });
      return out;
    });
  });
  return nodes;
}

// Icon + accent colour for a notification, by type. Системные строки (роль,
// доступ, оплата) остаются плиткой; строки с человеком-автором редизайн заменит
// на аватар из `sender` — но НЕ здесь (это подготовка, не сам визуал).
export function notifMeta(type = '') {
  const tp = String(type).toLowerCase();
  // Specific member/booking events first — they'd otherwise be swallowed by the
  // broader 'invite' / 'member' substring matches below.
  if (tp.includes('declined')) return { icon: 'user', color: 'var(--muted)' };
  if (tp.includes('removed')) return { icon: 'user', color: 'var(--danger)' };
  if (tp.includes('left')) return { icon: 'user', color: 'var(--warm)' };
  if (tp.includes('role')) return { icon: 'shield', color: 'var(--brand)' };
  if (tp.includes('booking')) return { icon: 'bed', color: 'var(--ai)' };
  if (tp.includes('invite')) return { icon: 'users', color: 'var(--brand)' };
  if (tp.includes('vote') || tp.includes('hotel')) return { icon: 'vote', color: 'var(--ai)' };
  if (tp.includes('pro') || tp.includes('subscription') || tp.includes('payment')) return { icon: 'pro', color: 'var(--pro)' };
  if (tp.includes('join') || tp.includes('member')) return { icon: 'user', color: 'var(--success)' };
  if (tp.includes('activity') || tp.includes('update') || tp.includes('edit')) return { icon: 'edit', color: 'var(--warm)' };
  return { icon: 'bell', color: 'var(--brand)' };
}

/**
 * Живое имя автора события из `sender`, либо undefined, если резолвить нечем.
 * Удалённый аккаунт → локализованная подпись (перекрывает снапшот-имя, чтобы оно
 * не пережило анонимизацию). Пустое живое имя → undefined (пусть решает фолбэк).
 * @param {any} sender @param {string} [deletedLabel]
 */
function senderName(sender, deletedLabel) {
  if (!sender) return undefined;
  if (sender.is_deleted) return deletedLabel || undefined;
  return sender.full_name || undefined;
}

/**
 * Собрать всё, что рисует строка: иконку-мету, признак приглашения и готовые
 * узлы заголовка/сообщения с ЖИВЫМ именем автора. Едина для обеих поверхностей.
 * @param {any} n сырая строка инбокса (несёт `sender` от getInbox)
 * @param {(key: string, params?: any) => string} t
 * @param {{ deletedLabel?: string }} [opts]
 */
export function buildNotifView(n, t, { deletedLabel } = {}) {
  const params = { ...(n.i18n_params || {}) };
  if (params.role_key) { params.role = t(params.role_key); delete params.role_key; }
  // Booking notifications carry `kind` as a code (hotel/transfer/service) — localize it.
  if (params.kind) params.kind = t('notif.booking_kind_' + params.kind);
  // Автор события — из sender (живое), снапшот params.name/inviter остаётся
  // фолбэком. Обе плейсхолдер-формы (`{name}` и `{inviter}`) указывают на автора,
  // поэтому заполняем оба резолвнутым именем.
  const author = senderName(n.sender, deletedLabel);
  if (author) { params.name = author; params.inviter = author; }

  const isInvite = n.type === 'trip_invite' && !!n.trip_member_id;
  const titleText = n.i18n_title_key ? t(n.i18n_title_key, params) : n.title;
  const messageText = n.i18n_message_key ? t(n.i18n_message_key, params) : n.message;
  const titleNode = isInvite
    ? emphasize(titleText, [{ value: params.trip, style: { fontWeight: 700 /* design-token-exempt: inline mention emphasis */, color: 'var(--brand)' } }])
    : titleText;
  const messageNode = isInvite
    ? emphasize(messageText, [{ value: params.inviter, style: { fontWeight: 700 /* design-token-exempt: inline mention emphasis */ } }])
    : messageText;

  return { meta: notifMeta(n.type), isInvite, titleNode, messageText, messageNode };
}
