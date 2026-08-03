// Single source of truth for all localized email/notification templates.
// Used by inviteTripMember, resendTripInvite (and any future functions).
import { withViralMarks } from './viralLink.ts';

const BRAND = 'Triplanio';

type Lang = 'en' | 'ru' | 'es';
type Role = 'admin' | 'viewer';

interface L {
  invite_subject: (title: string) => string;
  resend_subject: (title: string) => string;
  notif_title: (title: string) => string;
  notif_msg: (inviter: string, role: string) => string;
  joined_title: (name: string) => string;
  joined_msg: (title: string) => string;
  declined_title: (name: string) => string;
  declined_msg: (title: string) => string;
  left_title: (name: string) => string;
  left_msg: (title: string) => string;
  removed_title: string;
  removed_msg: (title: string) => string;
  role_changed_title: string;
  role_changed_msg: (roleLabel: string, title: string) => string;
  role_label: (role: string) => string;
}

const I18N: Record<Lang, L> = {
  en: {
    invite_subject: (title) => `Invitation to trip "${title}"`,
    resend_subject: (title) => `Reminder: invitation to trip "${title}"`,
    notif_title: (title) => `You have been invited to trip "${title}"`,
    notif_msg: (inviter, role) =>
      `${inviter} invites you as ${role === 'admin' ? 'an admin' : 'a viewer'}.`,
    joined_title: (name) => `${name} joined the trip`,
    joined_msg: (title) => `Accepted invitation to "${title}".`,
    declined_title: (name) => `${name} declined the invitation`,
    declined_msg: (title) => `To the trip "${title}"`,
    left_title: (name) => `${name} left the trip`,
    left_msg: (title) => `"${title}"`,
    removed_title: 'You were removed from the trip',
    removed_msg: (title) => `"${title}"`,
    role_changed_title: 'Your role has changed',
    role_changed_msg: (roleLabel, title) => `You are now ${roleLabel} in "${title}"`,
    role_label: (role) => (role === 'admin' ? 'an admin' : 'a viewer'),
  },
  ru: {
    invite_subject: (title) => `Приглашение в путешествие «${title}»`,
    resend_subject: (title) => `Напоминание: приглашение в путешествие «${title}»`,
    notif_title: (title) => `Вас пригласили в путешествие «${title}»`,
    notif_msg: (inviter, role) =>
      `${inviter} приглашает вас как ${role === 'admin' ? 'администратора' : 'участника'}.`,
    joined_title: (name) => `${name} присоединился к путешествию`,
    joined_msg: (title) => `Принял приглашение в «${title}».`,
    declined_title: (name) => `${name} отклонил приглашение`,
    declined_msg: (title) => `В путешествие «${title}»`,
    left_title: (name) => `${name} покинул путешествие`,
    left_msg: (title) => `«${title}»`,
    removed_title: 'Тебя удалили из путешествия',
    removed_msg: (title) => `«${title}»`,
    role_changed_title: 'Твоя роль изменилась',
    role_changed_msg: (roleLabel, title) => `Теперь ты ${roleLabel} в «${title}»`,
    role_label: (role) => (role === 'admin' ? 'администратор' : 'наблюдатель'),
  },
  es: {
    invite_subject: (title) => `Invitación al viaje «${title}»`,
    resend_subject: (title) => `Recordatorio: invitación al viaje «${title}»`,
    notif_title: (title) => `Te han invitado al viaje «${title}»`,
    notif_msg: (inviter, role) =>
      `${inviter} te invita como ${role === 'admin' ? 'administrador' : 'lector'}.`,
    joined_title: (name) => `${name} se unió al viaje`,
    joined_msg: (title) => `Aceptó la invitación a «${title}».`,
    declined_title: (name) => `${name} rechazó la invitación`,
    declined_msg: (title) => `Al viaje «${title}»`,
    left_title: (name) => `${name} salió del viaje`,
    left_msg: (title) => `«${title}»`,
    removed_title: 'Te eliminaron del viaje',
    removed_msg: (title) => `«${title}»`,
    role_changed_title: 'Tu rol ha cambiado',
    role_changed_msg: (roleLabel, title) => `Ahora eres ${roleLabel} en «${title}»`,
    role_label: (role) => (role === 'admin' ? 'administrador' : 'lector'),
  },
};

export function getLang(lang?: string | null): Lang {
  return (lang && lang in I18N) ? lang as Lang : 'en';
}

const INVITE_TEMPLATE = Deno.env.get('RESEND_TPL_INVITE') || 'trip-invite';

const LINK_STYLE = 'color:#2D7FF9; font-weight:600; text-decoration:none;';
const NAME_STYLE = 'color:#0F172A; font-weight:700;';

interface EmailStrings {
  preheader: (inviter: string, title: string) => string;
  heading: (role: Role) => string;
  intro: (inviterHtml: string, role: Role) => string;
  trip_label: string;
  badge: (role: Role) => string;
  cta: string;
  signup: (registerUrl: string) => string;
  fallback_label: string;
  footer_team: string;
  footer_note: string;
}

const EMAIL_I18N: Record<Lang, EmailStrings> = {
  en: {
    preheader: (inviter, title) => `${inviter} invited you to the trip "${title}".`,
    heading: (role) => role === 'admin' ? "You're invited to manage a trip" : "You're invited to a trip",
    intro: (nameHtml, role) => role === 'admin'
      ? `${nameHtml} is inviting you as an admin — you'll be able to edit the trip.`
      : `${nameHtml} is inviting you to join their trip.`,
    trip_label: 'Trip',
    badge: (role) => role === 'admin' ? 'Admin · can edit the trip' : 'Observer · view only',
    cta: 'Accept invitation',
    signup: (r) => `Don't have a Triplanio account yet? <a href="${r}" target="_blank" style="${LINK_STYLE}">Sign up here</a> to accept the invitation.`,
    fallback_label: 'Button not working? Copy this link:',
    footer_team: 'The Triplanio Team',
    footer_note: 'Plan trips together',
  },
  ru: {
    preheader: (inviter, title) => `${inviter} приглашает тебя в путешествие «${title}».`,
    heading: (role) => role === 'admin' ? 'Тебя пригласили управлять путешествием' : 'Тебя пригласили в путешествие',
    intro: (nameHtml, role) => role === 'admin'
      ? `${nameHtml} приглашает тебя как админа — ты сможешь редактировать путешествие.`
      : `${nameHtml} приглашает тебя присоединиться к путешествию.`,
    trip_label: 'Путешествие',
    badge: (role) => role === 'admin' ? 'Админ · редактирует путешествие' : 'Наблюдатель · только просмотр',
    cta: 'Принять приглашение',
    signup: (r) => `Ещё нет аккаунта Triplanio? <a href="${r}" target="_blank" style="${LINK_STYLE}">Зарегистрируйся здесь</a>, чтобы принять приглашение.`,
    fallback_label: 'Кнопка не работает? Скопируй ссылку:',
    footer_team: 'Команда Triplanio',
    footer_note: 'Планируй путешествия вместе',
  },
  es: {
    preheader: (inviter, title) => `${inviter} te invita al viaje «${title}».`,
    heading: (role) => role === 'admin' ? 'Te han invitado a gestionar un viaje' : 'Te han invitado a un viaje',
    intro: (nameHtml, role) => role === 'admin'
      ? `${nameHtml} te invita como administrador: podrás editar el viaje.`
      : `${nameHtml} te invita a unirte a su viaje.`,
    trip_label: 'Viaje',
    badge: (role) => role === 'admin' ? 'Administrador · puede editar el viaje' : 'Observador · solo lectura',
    cta: 'Aceptar invitación',
    signup: (r) => `¿Aún no tienes cuenta en Triplanio? <a href="${r}" target="_blank" style="${LINK_STYLE}">Regístrate aquí</a> para aceptar la invitación.`,
    fallback_label: '¿El botón no funciona? Copia este enlace:',
    footer_team: 'El equipo de Triplanio',
    footer_note: 'Planifica viajes en equipo',
  },
};

export function renderInviteTemplate(
  lang: string | null | undefined,
  kind: 'invite' | 'resend',
  params: { title: string; inviter: string; role: string; appUrl: string; tripId: string },
): { templateId: string; subject: string; variables: Record<string, string>; brand: string } {
  const langKey = getLang(lang);
  const L = I18N[langKey];
  const E = EMAIL_I18N[langKey];
  const role: Role = params.role === 'admin' ? 'admin' : 'viewer';
  const base = (params.appUrl || '').replace(/\/+$/, '');
  // Both links are marked (TRIP-329): an invite is sent to someone who is not a
  // participant yet, so either one can be a stranger's first visit — which is
  // the whole test for whether a link gets marked. The trip id rides
  // utm_campaign, so "which trips bring people in" is one field for all four
  // viral links, and it reaches `users.signup_utm_campaign` for recipients who
  // decline cookies.
  const accept_url = withViralMarks(`${base}/trips`, 'invite_email', params.tripId);
  const register_url = withViralMarks(`${base}/`, 'invite_email', params.tripId);
  const inviterHtml = `<strong style="${NAME_STYLE}">${params.inviter}</strong>`;

  return {
    templateId: INVITE_TEMPLATE,
    subject: kind === 'invite' ? L.invite_subject(params.title) : L.resend_subject(params.title),
    brand: BRAND,
    variables: {
      preheader: E.preheader(params.inviter, params.title),
      heading: E.heading(role),
      intro_html: E.intro(inviterHtml, role),
      trip_label: E.trip_label,
      trip_name: params.title,
      role_badge: E.badge(role),
      cta_label: E.cta,
      accept_url,
      signup_html: E.signup(register_url),
      fallback_label: E.fallback_label,
      footer_team: E.footer_team,
      footer_note: E.footer_note,
    },
  };
}

export function renderInviteNotification(
  lang: string | null | undefined,
  params: { title: string; inviter: string; role: string },
): { title: string; message: string } {
  const L = I18N[getLang(lang)];
  return {
    title: L.notif_title(params.title),
    message: L.notif_msg(params.inviter, params.role),
  };
}

export function renderJoinedNotification(
  lang: string | null | undefined,
  params: { name: string; title: string },
): { title: string; message: string } {
  const L = I18N[getLang(lang)];
  return {
    title: L.joined_title(params.name),
    message: L.joined_msg(params.title),
  };
}

// M1 — invite declined (shown to the inviter)
export function renderDeclinedNotification(
  lang: string | null | undefined,
  params: { name: string; title: string },
): { title: string; message: string } {
  const L = I18N[getLang(lang)];
  return {
    title: L.declined_title(params.name),
    message: L.declined_msg(params.title),
  };
}

// M2 — member left the trip (shown to owner + admins)
export function renderMemberLeftNotification(
  lang: string | null | undefined,
  params: { name: string; title: string },
): { title: string; message: string } {
  const L = I18N[getLang(lang)];
  return {
    title: L.left_title(params.name),
    message: L.left_msg(params.title),
  };
}

// M3 — you were removed from the trip (shown to the removed member)
export function renderMemberRemovedNotification(
  lang: string | null | undefined,
  params: { title: string },
): { title: string; message: string } {
  const L = I18N[getLang(lang)];
  return {
    title: L.removed_title,
    message: L.removed_msg(params.title),
  };
}

// M4 — your role changed (shown to the affected member)
export function renderRoleChangedNotification(
  lang: string | null | undefined,
  params: { role: string; title: string },
): { title: string; message: string } {
  const L = I18N[getLang(lang)];
  return {
    title: L.role_changed_title,
    message: L.role_changed_msg(L.role_label(params.role), params.title),
  };
}
