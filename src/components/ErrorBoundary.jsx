import { Sentry } from '@/lib/sentry';
import { EmptyState, Btn } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';

// Reusable in-place error boundary for a route or a feature region (a trip lens)
// (TRIP-219 F2). Wraps `Sentry.ErrorBoundary` from the already-installed SDK — it
// catches a render crash, captures it WITH the React component stack + route
// context, and renders a compact design-system fallback that keeps the app shell
// and navigation alive. The user retries the failed region in place (`resetError`)
// instead of white-screening the whole app.
//
// The top-level `AppErrorBoundary` stays as the LAST-RESORT full-screen crash for
// provider failures (i18n / router) that everything below renders inside; this one
// isolates a single screen or lens so a local crash never takes the app down.
//
// Reuses the existing `sys.load_error_*` / `sys.retry` strings (the same copy the
// load-error EmptyStates already use), so no new i18n keys are introduced.

function RegionFallback({ resetError }) {
  const { t } = useI18n();
  return (
    <EmptyState
      kind="error"
      icon="warning"
      title={t('sys.load_error_title')}
      body={t('sys.load_error_desc')}
      action={<Btn variant="primary" icon="refresh" onClick={resetError}>{t('sys.retry')}</Btn>}
    />
  );
}

export default function ErrorBoundary({ region, children }) {
  return (
    <Sentry.ErrorBoundary
      beforeCapture={(scope) => {
        scope.setTag('surface', 'frontend');
        if (region) scope.setTag('region', region);
      }}
      fallback={({ resetError }) => <RegionFallback resetError={resetError} />}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}
