import { useEffect, useState } from 'react';
import { Btn } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import { isAnalyticsOn } from '@/lib/analytics';
import {
  applyConsent, clearAnalyticsStorage, getConsent, setConsent, subscribeConsentOpen,
} from '@/lib/consent';

/**
 * Cookie-consent panel (TRIP-311). Mounted once, as a sibling of <Toaster/> and
 * OUTSIDE <Router> — so it shows on every entry, including the anonymous ones
 * that matter most: a public trip link and an invite. Both are the viral funnel,
 * and both would otherwise be left tracked without an answer.
 *
 * Deliberately NOT the `.sheet` canon: that is modal by construction (scrim,
 * z-201, swipe/close affordances), and a way to dismiss without choosing cannot
 * count as an answer. This is a plain fixed panel — no scrim, no close button,
 * no focus trap, no scroll lock. Ignoring it leaves the app fully usable, which
 * is what keeps it from being a cookie wall.
 *
 * Both buttons are the same size in the same grid so refusing is exactly as easy
 * as accepting; a muted, borderless "reject" is the pattern regulators fine.
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
    // Use what setConsent returns rather than re-reading storage: in private
    // browsing the write throws, getConsent() would then come back null, and
    // someone who just pressed "Accept all" would silently get no analytics.
    const record = setConsent(accepted);
    setOpen(false);

    if (accepted) {
      // Pass the uid so an already-signed-in visitor becomes a person
      // immediately — AuthContext only calls identify() on its own auth cycle,
      // which for someone already on a screen would not come round until the
      // next load.
      applyConsent(record, user?.id);
      return;
    }

    // Withdrawing after PostHog has already started is the one case that needs a
    // reload: an initialised client cannot be shut down, so the only honest way
    // back to "analytics does not exist" is a new document. Refusing when it was
    // never running changes nothing on screen and must not throw the page away.
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
