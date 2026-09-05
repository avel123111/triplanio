import { useEffect, useState } from 'react';
// Кнопка — из своего модуля, не через баррель: баннер стоит на ЛЕНДИНГЕ и он же
// LCP-элемент, а баррель тянет за собой весь слой оверлеев (TRIP-475).
import { Btn } from '@/design/Btn';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import { applyConsent, getConsent, setConsent, subscribeConsentOpen } from '@/lib/consent';

/**
 * Cookie-consent panel (TRIP-311). Mounted OUTSIDE <Router> so it also shows on
 * the anonymous entries that matter most — public trip link and invite.
 *
 * Not the `.sheet` canon: that is modal by construction, and a way to dismiss
 * without choosing cannot count as an answer. No scrim, no close button, no
 * focus trap — ignoring it must leave the app usable, or it is a cookie wall.
 * Both buttons are the same size so refusing is as easy as accepting.
 */
export default function ConsentBanner() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [open, setOpen] = useState(() => getConsent() === null);

  // "Cookie settings" reopens this panel instead of changing anything by itself:
  // looking at your choice must not cost you it.
  useEffect(() => subscribeConsentOpen(() => setOpen(true)), []);

  if (!open) return null;

  const answer = (accepted) => {
    // Not a re-read: in private browsing the write throws and getConsent() would
    // come back null, silently denying analytics to someone who just accepted.
    const record = setConsent(accepted);
    setOpen(false);
    // Both answers are one SDK switch each (grant → capture and storage on,
    // refusal → opted out, and the SDK wipes what it stored); the uid so an
    // already-signed-in visitor is (re)identified now, not on the next load.
    applyConsent(record, user?.id);
  };

  return (
    <div className="consent" role="region" aria-label={t('consent.title')}>
      <div className="consent__text">
        <p className="t-label consent__title">{t('consent.title')}</p>
        <p className="t-meta">
          {t('consent.body')}{' '}
          <a href="/privacy" target="_blank" rel="noreferrer">{t('consent.privacy')}</a>
        </p>
      </div>
      <div className="grid grid--2 grid--g4">
        <Btn variant="secondary" onClick={() => answer(false)}>{t('consent.necessary_only')}</Btn>
        <Btn variant="primary" onClick={() => answer(true)}>{t('consent.accept_all')}</Btn>
      </div>
    </div>
  );
}
