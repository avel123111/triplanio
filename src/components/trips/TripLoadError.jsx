import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/lib/i18n/I18nContext';
import { SystemStub } from '@/lib/PageNotFound';

// Shared "couldn't load the trip — temporary error" screen (TRIP-56). Shown for
// 500 / network / unknown failures, where the trip likely exists and the user
// has rights but the load failed transiently — so it offers a retry instead of
// the "no access" message (TripAccessError, which is for real 403/404). Built on
// the same SystemStub family as TripAccessError so the two read as one system.
export default function TripLoadError({ onRetry, onBack }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const goBack = onBack || (() => nav('/trips'));
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <SystemStub
        icon="warning"
        tone="warning"
        title={t('trip.load_error_title')}
        body={t('trip.load_error_desc')}
        primary={{ label: t('trip.retry'), onClick: onRetry }}
        secondary={{ label: t('trip.to_my_trips'), onClick: goBack }}
      />
    </div>
  );
}
