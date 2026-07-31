import { useEffect, useState } from 'react';
import { Btn } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import { isAnalyticsOn } from '@/lib/analytics';
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

    // Only a real downgrade needs a reload: an initialised client cannot be shut
    // down. Refusing when it never ran must not throw the page away.
    if (isAnalyticsOn()) {
      clearAnalyticsStorage();
      window.location.reload();
    }
  };

  return (
    <div className="consent" role="region" aria-label={t('consent.title')}>
      <div className="consent__text">
        <p className="t-subheading consent__title">{t('consent.title')}</p>
        <p className="t-body">
          {t('consent.body')}{' '}
          <a href="/privacy" target="_blank" rel="noreferrer">{t('consent.privacy')}</a>
        </p>
      </div>
      <div className="consent__actions">
        <Btn variant="secondary" onClick={() => answer(false)}>{t('consent.necessary_only')}</Btn>
        <Btn variant="primary" onClick={() => answer(true)}>{t('consent.accept_all')}</Btn>
      </div>
    </div>
  );
}
