import { Component } from 'react';
import { Sentry } from '@/lib/sentry';
import { useI18n } from '@/lib/i18n/I18nContext';

// Region-level error boundary (TRIP-219 F2; расшита в TRIP-475 Ф1.0). Изолирует
// крах одного роута/линзы: показывает retry НА МЕСТЕ, оболочка и навигация
// (соседи) остаются живы. `AppErrorBoundary` при этом — последний рубеж на весь
// экран для отказа провайдеров (i18n / router); эта граница ловит один экран.
//
// ★ СВОЯ класс-граница, НЕ `Sentry.ErrorBoundary` (TRIP-475 Ф1.0). Пока граница
// была КОМПОНЕНТОМ SDK, весь `@sentry/react` (Replay+tracing, ~432 КБ) был обязан
// приехать СИНХРОННО к первому рендеру. Захват теперь — вызов функции
// `Sentry.captureException`, поэтому рендер границы от SDK не зависит, и сам SDK
// уходит на ленивую загрузку (Ф1.4). `beforeCapture`-теги перенесены в
// `componentDidCatch` один-в-один (surface=frontend + region).
//
// ★ Fallback БЕЗ дизайн-системы (TRIP-475 Ф1.0). `EmptyState`/`Btn` тянули
// статический `@/design` → `app.css` в render-blocking entry-CSS ВСЕХ роутов,
// включая лендинг. Разметка теперь самодостаточна.
//
// ★ Цвет — `var(--токен, #литерал)`, а НЕ голый литерал. РЕГИОНАЛЬНАЯ граница
// рендерится ГЛУБОКО внутри приложения, где `app.css` уже в документе, поэтому
// `var()` резолвится — и цвет САМ адаптируется к тёмной теме (`--ink` там светлый),
// чего голый инлайн-литерал не умеет. Литерал — лишь crash-safe ЗАПАС на случай,
// если слой не приехал; он РАВЕН токену светлой темы и это держит тест
// `ErrorBoundary.test.js` (иначе кнопка «Повторить» уедет в другой синий, и это
// увидит только пользователь в момент краха — тот же принцип, что splash.test.js).
// Отличие от заставки TRIP-478: та рисуется ДО прихода app.css, ей `var()` не
// доступен и она держит ЧИСТЫЕ литералы обеих тем; здесь слой на месте.
//
// Строки — те же `sys.load_error_*` / `sys.retry`, новых i18n-ключей нет. Сброс —
// `key={path}` на вызывающей стороне (перемонтирование на навигации) + `resetError`.

// floor-exempt: inline +4 — четыре объекта style в crash-safe fallback без ДС;
// апрув Pavel по Ф1.0 (TRIP-475). Замер base-относителен (check:floor vs dev).
// floor-exempt: dsshare +9 — снятие EmptyState/Btn с аварийного экрана убирает
// @/design из синхронного графа (снимает app.css с render-blocking entry); размен
// доли ДС на аварийном fallback согласован, апрув Pavel по Ф1.0 (TRIP-475).
function RegionFallback({ resetError }) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, minHeight: 200, textAlign: 'center' }}  /* inline-style-exempt: crash-safe fallback, не зависит от app.css — TRIP-475 Ф1.0 */
    >
      <div aria-hidden>⚠️</div>{/* эмодзи-иконка дефолтным размером: инлайн font-size под TYPOGRAPHY-гардом, а .t-* класс зависел бы от app.css, который при краше мог не приехать (TRIP-475 Ф1.0) */}
      <p style={{ margin: 0, fontWeight: 700, color: 'var(--ink, #272433)' }}>{t('sys.load_error_title')}</p>{/* inline-style-exempt + design-token-exempt: crash-safe fallback, токен с литералом-запасом = токен светлой темы (тест) — TRIP-475 Ф1.0 */}
      <p style={{ margin: 0, maxWidth: 360, color: 'var(--ink-2, #4A4659)' }}>{t('sys.load_error_desc')}</p>{/* inline-style-exempt + design-token-exempt: crash-safe fallback — TRIP-475 Ф1.0 */}
      {/* Ссылка-кнопка, а НЕ залитая: залитый скин (радиус+фон+рамка) — это
          «поверхность», её дом примитив <Card>/<Btn> (гард 2z), а он тянет
          @/design. Текстовый retry под гард не попадает и для аварийного экрана
          уместен. Цвет — тот же `var(--brand, литерал)`. */}
      <button
        type="button"
        onClick={resetError}
        style={{ border: 'none', background: 'transparent', padding: 0, color: 'var(--brand, #2173C8)', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}  /* inline-style-exempt + design-token-exempt: crash-safe fallback, --brand с литералом-запасом = токен (тест) — TRIP-475 Ф1.0 */
      >
        {t('sys.retry')}
      </button>
    </div>
  );
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // No-op когда Sentry без DSN (локальный dev). Теги — те же, что задавал
    // `beforeCapture` у прежней `Sentry.ErrorBoundary`.
    Sentry.captureException(error, {
      tags: this.props.region ? { surface: 'frontend', region: this.props.region } : { surface: 'frontend' },
      contexts: { react: { componentStack: info?.componentStack } },
    });
  }

  render() {
    if (this.state.hasError) {
      return <RegionFallback resetError={() => this.setState({ hasError: false })} />;
    }
    return this.props.children;
  }
}
