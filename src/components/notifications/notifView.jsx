// @ts-check
// Единый резолвер строки уведомления — ОДИН дом для попапа колокольчика и экрана
// «Входящие» (раньше `renderParams` жил копией в обоих). Здесь имя автора события
// становится ЖИВЫМ: оно берётся из `n.sender` (создатель `created_by`, резолв на
// сервере — getInbox), а не из снапшота в тексте. Так закрывается утечка «имя
// вварено в строку и переживает анонимизацию»; аватар редизайн возьмёт из того же
// `sender`. Снапшот в `i18n_params` (у строк-триггеров) остаётся тихим фолбэком.
import React from 'react';

// Render `text`, wrapping each given value in an <em> so the canon owns the look:
// `.notif__title em` (бренд+жирный) и `.notif__msg em` (жирный) — стиль на классе
// родителя, у самого выделения ни инлайна, ни своего имени. Используется, чтобы
// подсветить название трипа в заголовке и имя пригласившего в сообщении.
export function emphasize(text, values = []) {
  if (text == null) return text;
  let nodes = [String(text)];
  values.filter(Boolean).forEach((value, vi) => {
    nodes = nodes.flatMap((node, ni) => {
      if (typeof node !== 'string') return [node];
      const segs = node.split(value);
      const out = [];
      segs.forEach((s, si) => {
        if (s) out.push(s);
        if (si < segs.length - 1) out.push(<em key={`e${vi}-${ni}-${si}`}>{value}</em>);
      });
      return out;
    });
  });
  return nodes;
}

// Глиф строки по ТИПУ события (матрица аватар/плитка, апрув Pavel):
//   • человек сделал соц-действие (invite/joined/declined/left/booking) → АВАТАР
//     автора из `sender` — рисуется примитивом <Avatar> ровно как везде (нет
//     фото → инициалы+градиент, удалённый → «Удалённый аккаунт»);
//   • про твой аккаунт/доступ/оплату (role/removed/payment) → тинт-ПЛИТКА <Tile>;
//   • подписка активирована → PRO-глиф (золотой градиент).
// Возвращает ДЕСКРИПТОР (данные), не JSX: рендерит его NotifRow (примитивами ДС).
/** @param {string} type @param {any} [sender] */
export function notifGlyph(type, sender) {
  const tp = String(type).toLowerCase();
  if (tp.includes('pro_activated')) return { mode: 'pro' };
  if (tp.includes('payment')) return { mode: 'tile', icon: 'card', tone: 'danger' };
  if (tp.includes('removed')) return { mode: 'tile', icon: 'lock', tone: 'danger' };
  if (tp.includes('role')) return { mode: 'tile', icon: 'shield', tone: 'brand' };
  if (tp.includes('invite') || tp.includes('join') || tp.includes('member')
    || tp.includes('declined') || tp.includes('left') || tp.includes('booking')) {
    return {
      mode: 'avatar',
      name: sender?.name || undefined,
      photo: sender?.avatar_url || undefined,
      deleted: !!sender?.is_deleted,
      // Stable colour key = the author's id, so their notification avatar matches
      // their colour on the member list (never the mutable display name).
      seed: sender?.id || undefined,
    };
  }
  return { mode: 'tile', icon: 'bell', tone: 'quiet' };
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
  // `sender.name` is ALREADY the resolved display name (full_name → e-mail
  // local-part) decided by the backend's one displayName ladder — so an author
  // without a full_name reads "Test8" here exactly as on the trip screens, not
  // "?" nor the raw address the old i18n_params snapshot carried.
  return sender.name || undefined;
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
  // Роль — ЕДИНЫЙ канон `trips.role_*` (тот же лейбл, что <RoleBadge>), а не своя
  // копия `notif.role_*`. `role_key` приходит из БД как 'notif.role_admin'/
  // '..._viewer' (указатель) — берём из него код и резолвим канон-ключом.
  if (params.role_key) {
    const roleCode = String(params.role_key).includes('admin') ? 'admin' : 'viewer';
    params.role = t(`trips.role_${roleCode}`);
    delete params.role_key;
  }
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
  const titleNode = isInvite ? emphasize(titleText, [params.trip]) : titleText;
  const messageNode = isInvite ? emphasize(messageText, [params.inviter]) : messageText;

  // «Открыть путешествие» — ЕДИНЫЙ предикат для инбокса И колокольчика (был
  // продублирован построчно в обоих, расходился молча). Показываем ссылку только
  // тем, у кого ещё есть доступ: приглашение — лишь после принятия (member_status
  // active), а `trip_member_removed` адресовано ИСКЛЮЧЁННОМУ участнику — открывать
  // ему нечего (роут отдаст 403/пустоту), поэтому ссылку прячем.
  const showLink = !!n.trip_id
    && n.type !== 'trip_member_removed'
    && (n.member_status === 'active' || n.type !== 'trip_invite');

  return {
    glyph: notifGlyph(n.type, n.sender),
    isInvite,
    titleNode,
    messageText,
    messageNode,
    showLink,
  };
}
