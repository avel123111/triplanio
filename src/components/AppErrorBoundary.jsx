import React from 'react';
import { Sentry } from '@/lib/sentry';

// Self-contained copy for the crash screen. An error boundary can render when
// the app (incl. the i18n provider) has failed, so it must NOT depend on the
// React i18n context. Pick the language from the same storage the app uses.
const CRASH_COPY = {
  en: { title: 'Something went wrong', generic: 'Unknown error', home: 'Go home' },
  ru: { title: 'Что-то пошло не так', generic: 'Неизвестная ошибка', home: 'На главную' },
  es: { title: 'Algo salió mal', generic: 'Error desconocido', home: 'Ir al inicio' },
};
function crashLang() {
  try {
    const l = (localStorage.getItem('travel-planner-lang')
      || (navigator.language || 'en').slice(0, 2)).toLowerCase();
    return CRASH_COPY[l] ? l : 'en';
  } catch { return 'en'; }
}

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[AppErrorBoundary]', error, info);
    // No-op when Sentry isn't initialised (no DSN, e.g. local dev).
    Sentry.captureException(error, {
      contexts: { react: { componentStack: info?.componentStack } },
    });
  }

  render() {
    if (this.state.hasError) {
      const c = CRASH_COPY[crashLang()];
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 16, padding: 32, fontFamily: 'sans-serif',
          background: '#f6f7f9', color: '#374257',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: '#fee2e2',
            display: 'grid', placeItems: 'center', fontSize: 'var(--fs-h2)',
          }}>⚠️</div>
          <h2 style={{ margin: 0, fontSize: 'var(--fs-h3)', fontWeight: 700 }}>{c.title}</h2>
          <p style={{ margin: 0, color: '#8693a8', fontSize: 'var(--fs-strong)', textAlign: 'center', maxWidth: 400 }}>
            {this.state.error?.message || c.generic}
          </p>
          <button
            onClick={() => window.location.href = '/'}
            style={{
              padding: '10px 20px', borderRadius: 10, border: 'none',
              background: '#2167e2', color: 'white', fontWeight: 600,
              fontSize: 'var(--fs-strong)', cursor: 'pointer',
            }}
          >
            {c.home}
          </button>
          {import.meta.env.DEV && (
            <pre style={{
              marginTop: 16, padding: 16, background: '#fff', borderRadius: 8,
              border: '1px solid #e2e6ef', fontSize: 'var(--fs-micro)', maxWidth: '100%',
              overflow: 'auto', color: '#374257',
            }}>
              {this.state.error?.stack}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
