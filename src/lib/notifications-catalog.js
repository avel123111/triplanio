/**
 * Notifications Catalog - single source of truth that documents every
 * notification the app sends.
 *
 * This is a STATIC catalog maintained by developers. When you add, remove
 * or modify a notification anywhere in the codebase, update this file too.
 * The admin page at /admin/notifications renders this catalog as a table.
 *
 * Channels:
 *   - inapp:    Notification entity (rendered by NotificationsBell)
 *   - email:    SendEmail integration
 *   - telegram: Telegram Bot API (sendMessage)
 *
 * `i18nKeys` references translation keys; `hardcodedText` lists fallback /
 * baseline text shipped in the code (e.g. Russian-only Telegram reminders).
 */

export const NOTIFICATIONS = [
  // ─── IN-APP ─────────────────────────────────────────────────────────────
  {
    id: 'inapp.trip_invite',
    channel: 'inapp',
    trigger: 'User invited to a trip',
    when: 'Immediately on invite',
    audience: 'Invitee',
    source: 'functions/inviteTripMember',
    i18nKeys: { title: 'notif.tpl_invite_title', message: 'notif.tpl_invite_msg' },
    hardcodedText: null,
    comment: 'Bell notification with Accept/Decline. Localized at view time via i18n keys.',
  },
  {
    id: 'inapp.trip_member_joined',
    channel: 'inapp',
    trigger: 'Invitee accepted the invitation',
    when: 'Immediately on accept',
    audience: 'Inviter',
    source: 'functions/respondTripInvite',
    i18nKeys: { title: 'notif.tpl_joined_title', message: 'notif.tpl_joined_msg' },
    hardcodedText: null,
    comment: 'Lets the inviter know the invitee is now an active member.',
  },
  {
    id: 'inapp.pro_activated',
    channel: 'inapp',
    trigger: 'Stripe checkout.session.completed (Pro monthly/yearly)',
    when: 'Right after successful payment',
    audience: 'Buyer',
    source: 'functions/stripe-webhook',
    i18nKeys: { title: 'notif.tpl_pro_activated_title', message: 'notif.tpl_pro_activated_msg' },
    hardcodedText: null,
    comment: 'Confirms Pro subscription is active. Skipped for one-off Pro-trip purchases (UI shows a Welcome dialog there).',
  },

  // ─── EMAIL ──────────────────────────────────────────────────────────────
  {
    id: 'email.trip_invite',
    channel: 'email',
    trigger: 'User invited to a trip',
    when: 'Immediately on invite (best-effort, non-blocking)',
    audience: 'Invitee (their email)',
    source: 'functions/inviteTripMember → _shared/emailTemplate.ts (renderInviteEmail)',
    i18nKeys: null,
    hardcodedText: {
      subject_en: 'Invitation to trip "{title}"',
      subject_ru: 'Приглашение в путешествие «{title}»',
      subject_es: 'Invitación al viaje «{title}»',
    },
    comment: 'Localized to the invitee\'s saved User.language (defaults to en). Body links to the app.',
  },
  {
    id: 'email.trip_invite_resend',
    channel: 'email',
    trigger: 'Admin clicks "Resend" on a pending invite',
    when: 'On demand',
    audience: 'Invitee (their email)',
    source: 'functions/resendTripInvite → _shared/emailTemplate.ts (renderInviteEmail)',
    i18nKeys: null,
    hardcodedText: {
      subject_en: 'Reminder: invitation to trip "{title}"',
      subject_ru: 'Напоминание: приглашение в путешествие «{title}»',
      subject_es: 'Recordatorio: invitación al viaje «{title}»',
    },
    comment: 'Same body as initial invite, just a reminder-style subject line.',
  },

  // ─── TELEGRAM ───────────────────────────────────────────────────────────
  {
    id: 'telegram.bot_welcome',
    channel: 'telegram',
    trigger: 'User runs /start <token> in the bot',
    when: 'Immediately on /start',
    audience: 'User who linked Telegram',
    source: 'functions/telegramWebhook',
    i18nKeys: null,
    hardcodedText: {
      ru: '✅ Готово! Теперь я подключён к поездке <b>{trip}</b>. Я буду присылать напоминания о ключевых событиях: заезд/выезд из отеля, отправление трансфера, начало активностей.',
    },
    comment: 'Confirms successful binding of Telegram chat → trip. Localized ru/en/es in telegramWebhook (T table).',
  },
  {
    id: 'telegram.bot_link_errors',
    channel: 'telegram',
    trigger: '/start with bad / used / expired token',
    when: 'Immediately on /start',
    audience: 'User attempting to link',
    source: 'functions/telegramWebhook',
    i18nKeys: null,
    hardcodedText: {
      ru: '❌ Ссылка недействительна / уже использована / срок истёк. Сгенерируйте новую в настройках поездки.',
    },
    comment: 'Three error variants for invalid/used/expired link tokens. Localized ru/en/es in telegramWebhook.',
  },
  {
    id: 'telegram.hotel_cancel_deadline',
    channel: 'telegram',
    trigger: 'Hotel with free_cancellation_until set',
    when: '24h before deadline (±15min window)',
    audience: 'All active Telegram users on the trip',
    source: 'functions/getPendingReminders (n8n dispatch)',
    i18nKeys: null,
    hardcodedText: { ru: '⏰ Через 24 часа истекает бесплатная отмена отеля\\n\\n🧳 {trip}\\n🏨 {hotel} - {city}\\n📅 Дедлайн: {datetime}' },
    comment: 'Deduplicated per (user, event_id) via TelegramReminderLog. Text formatted by n8n; getPendingReminders passes user_locale (en/es depend on n8n templates).',
  },
  {
    id: 'telegram.hotel_checkin',
    channel: 'telegram',
    trigger: 'Hotel check-in datetime',
    when: '24h before check-in (±15min)',
    audience: 'All active Telegram users on the trip',
    source: 'functions/getPendingReminders (n8n dispatch)',
    i18nKeys: null,
    hardcodedText: { ru: '🏨 Завтра заезд в отель (через 24 часа)\\n\\n🧳 {trip}\\n🏨 {hotel} - {city}\\n📅 Заезд: {datetime}\\n📍 {address}\\n🔖 Бронь: {booking_ref}' },
    comment: 'Includes hotel name, address, booking ref. Text formatted by n8n; getPendingReminders passes user_locale (en/es depend on n8n templates).',
  },
  {
    id: 'telegram.hotel_checkout',
    channel: 'telegram',
    trigger: 'Hotel check-out datetime',
    when: '18h before check-out (±15min)',
    audience: 'All active Telegram users on the trip',
    source: 'functions/getPendingReminders (n8n dispatch)',
    i18nKeys: null,
    hardcodedText: { ru: '🧳 Через 18 часов выезд из отеля\\n\\n🧳 {trip}\\n🏨 {hotel} - {city}\\n📅 Выезд: {datetime}' },
    comment: 'Text formatted by n8n; getPendingReminders passes user_locale (en/es depend on n8n templates).',
  },
  {
    id: 'telegram.transfer_start',
    channel: 'telegram',
    trigger: 'Transfer departure datetime',
    when: '4h before departure (±15min)',
    audience: 'All active Telegram users on the trip',
    source: 'functions/getPendingReminders (n8n dispatch)',
    i18nKeys: null,
    hardcodedText: { ru: '{transport_icon} {transport_label} через 4 часа\n\n🧳 {trip}\n🛫 Отправление: {datetime}\n📍 Откуда: {from_address}\n📍 Куда: {to_address}\n🏷️ {carrier}\n🔖 Бронь: {booking_ref}' },
    comment: 'Icon and label depend on transport_type. Text formatted by n8n; getPendingReminders passes user_locale (en/es depend on n8n templates).',
  },
  {
    id: 'telegram.car_rental_start',
    channel: 'telegram',
    trigger: 'Car rental pickup_at_local (+pickup_timezone)',
    when: '18h before pickup (±15min)',
    audience: 'All active Telegram users on the trip',
    source: 'functions/getPendingReminders (n8n dispatch)',
    i18nKeys: null,
    hardcodedText: { ru: '🚗 Через 18 часов - получение арендованного авто\\n\\n🧳 {trip}\\n🏷️ {service_name}' },
    comment: 'Needs pickup_timezone set on the rental - legacy records without TZ are skipped. Text formatted by n8n; getPendingReminders passes user_locale (en/es depend on n8n templates).',
  },
  {
    id: 'telegram.car_rental_end',
    channel: 'telegram',
    trigger: 'Car rental dropoff_at_local (+dropoff_timezone or pickup_timezone)',
    when: '18h before drop-off (±15min)',
    audience: 'All active Telegram users on the trip',
    source: 'functions/getPendingReminders (n8n dispatch)',
    i18nKeys: null,
    hardcodedText: { ru: '🚗 Через 18 часов - возврат арендованного авто\\n\\n🧳 {trip}\\n🏷️ {service_name}' },
    comment: 'Text formatted by n8n; getPendingReminders passes user_locale (en/es depend on n8n templates).',
  },
  {
    id: 'telegram.activity_start',
    channel: 'telegram',
    trigger: 'Activity start_datetime',
    when: '4h before start (±15min)',
    audience: 'All active Telegram users on the trip',
    source: 'functions/getPendingReminders (n8n dispatch)',
    i18nKeys: null,
    hardcodedText: { ru: '🎟️ Через 4 часа - активность\\n\\n🧳 {trip}\\n📌 {title} - {city}\\n📅 Начало: {datetime}\\n📍 {address}' },
    comment: 'Includes activity title, city, address. Text formatted by n8n; getPendingReminders passes user_locale (en/es depend on n8n templates).',
  },
];

export const CHANNELS = {
  inapp:    { label: 'In-app',   icon: 'Bell',         color: 'text-blue-600 bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300' },
  email:    { label: 'Email',    icon: 'Mail',         color: 'text-amber-700 bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300' },
  telegram: { label: 'Telegram', icon: 'Send',         color: 'text-emerald-700 bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300' },
};