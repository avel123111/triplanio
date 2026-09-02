import { useEffect, useState } from 'react';
// Кнопка — из своего модуля, не через баррель: баннер стоит на ЛЕНДИНГЕ и он же
// LCP-элемент, а баррель тянет за собой весь слой оверлеев (TRIP-475).
import { Btn } from '@/design/Btn';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import {
  applyConsent, clearAnalyticsStorage, getConsent, setConsent, subscribeConsentOpen,
} from '@/lib/consent';

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

    if (accepted) {
      // uid so an already-signed-in visitor becomes a person now, not next load.
      applyConsent(record, user?.id);
      return;
    }

    // A refusal is an objection, and it has to bite: the client cannot un-init, so
    // we wipe what it stored and throw the page away. Since TRIP-502 analytics runs
    // from load for everyone, so this always applies — there is no longer a
    // memory-only session that wrote nothing.
    clearAnalyticsStorage();
    window.location.reload();
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
