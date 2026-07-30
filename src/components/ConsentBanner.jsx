import { useState } from 'react';
import { Btn } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import { applyConsent, getConsent, setConsent } from '@/lib/consent';

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
  // Read once: the answer cannot change under us while the panel is open, and
  // re-reading storage on every render would be a lie about where state lives.
  const [answered, setAnswered] = useState(() => getConsent() !== null);

  if (answered) return null;

  const answer = (accepted) => {
    const record = setConsent(accepted);
    // Pass the uid so an already-signed-in visitor becomes a person immediately
    // — AuthContext only calls identify() on its own auth cycle, which for
    // someone already on a screen would not come round until the next load.
    if (accepted) applyConsent(record, user?.id);
    setAnswered(true);
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
