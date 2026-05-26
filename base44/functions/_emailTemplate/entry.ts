// Internal helper function. Returns localized email templates for trip invites.
// Single source of truth — both inviteTripMember and resendTripInvite call this
// via base44.functions.invoke('_emailTemplate', { kind, lang, params }).
//
// Auth: requires an authenticated caller (other backend functions invoke it
// on behalf of the user). Never exposed to the frontend.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const BRAND = 'Triplanio';

const I18N = {
  en: {
    role_admin: 'admin (with edit rights)',
    role_viewer: 'viewer (read-only)',
    hello: 'Hello!',
    body: (inviter, title, role) =>
      `${inviter} is inviting you to join planning of the trip "${title}" as a ${role}.`,
    open: 'Open the app to accept the invitation:',
    signup_hint: (email) =>
      `If you don't have an account yet — first sign up with the same email (${email}), and the invitation will appear in your notifications.`,
    signature: `— ${BRAND}`,
    invite_subject: (title) => `Invitation to trip "${title}"`,
    resend_subject: (title) => `Reminder: invitation to trip "${title}"`,
    notif_title: (title) => `You have been invited to trip "${title}"`,
    notif_msg: (inviter, role) =>
      `${inviter} invites you as ${role === 'admin' ? 'an admin' : 'a viewer'}.`,
  },
  ru: {
    role_admin: 'администратора (с правом редактирования)',
    role_viewer: 'участника (просмотр)',
    hello: 'Здравствуйте!',
    body: (inviter, title, role) =>
      `${inviter} приглашает вас принять участие в планировании путешествия «${title}» в качестве ${role}.`,
    open: 'Откройте приложение, чтобы принять приглашение:',
    signup_hint: (email) =>
      `Если у вас ещё нет аккаунта — сначала зарегистрируйтесь по тому же email (${email}), и приглашение появится у вас в уведомлениях.`,
    signature: `— ${BRAND}`,
    invite_subject: (title) => `Приглашение в путешествие «${title}»`,
    resend_subject: (title) => `Напоминание: приглашение в путешествие «${title}»`,
    notif_title: (title) => `Вас пригласили в путешествие «${title}»`,
    notif_msg: (inviter, role) =>
      `${inviter} приглашает вас как ${role === 'admin' ? 'администратора' : 'участника'}.`,
  },
  es: {
    role_admin: 'administrador (con derechos de edición)',
    role_viewer: 'lector (solo lectura)',
    hello: '¡Hola!',
    body: (inviter, title, role) =>
      `${inviter} te invita a participar en la planificación del viaje «${title}» como ${role}.`,
    open: 'Abre la aplicación para aceptar la invitación:',
    signup_hint: (email) =>
      `Si aún no tienes una cuenta, regístrate con el mismo correo (${email}) y la invitación aparecerá en tus notificaciones.`,
    signature: `— ${BRAND}`,
    invite_subject: (title) => `Invitación al viaje «${title}»`,
    resend_subject: (title) => `Recordatorio: invitación al viaje «${title}»`,
    notif_title: (title) => `Te han invitado al viaje «${title}»`,
    notif_msg: (inviter, role) =>
      `${inviter} invites you as ${role === 'admin' ? 'administrador' : 'lector'}.`,
  },
};

// Fix the small typo above for Spanish notif_msg (kept verbatim translations otherwise).
I18N.es.notif_msg = (inviter, role) =>
  `${inviter} te invita como ${role === 'admin' ? 'administrador' : 'lector'}.`;

function renderInviteEmail(L, { inviter, title, role, recipientEmail, appUrl }) {
  const roleText = role === 'admin' ? L.role_admin : L.role_viewer;
  return `${L.hello}

${L.body(inviter, title, roleText)}

${L.open}
${appUrl}

${L.signup_hint(recipientEmail)}

${L.signature}`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { kind, lang, params } = await req.json();

    const langKey = (lang && I18N[lang]) ? lang : 'en';
    const L = I18N[langKey];

    if (kind === 'invite_email' || kind === 'resend_email') {
      const subject = kind === 'invite_email'
        ? L.invite_subject(params.title)
        : L.resend_subject(params.title);
      const body = renderInviteEmail(L, params);
      return Response.json({ subject, body, signature: L.signature, brand: BRAND });
    }

    if (kind === 'invite_notification') {
      return Response.json({
        title: L.notif_title(params.title),
        message: L.notif_msg(params.inviter, params.role),
        brand: BRAND,
      });
    }

    return Response.json({ error: 'Unknown kind' }, { status: 400 });
  } catch (error) {
    console.error('_emailTemplate error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});