import React from 'react';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Shared timezone hint. Two display modes:
 *
 *  - variant="under" (default): used under date/time inputs in EDIT dialogs.
 *      Renders as a small "🕐 Europe/Madrid" line beneath the input.
 *      When `tz` is empty/UTC - returns null (nothing to clarify).
 *
 *  - variant="inline": used inside VIEW dialogs, rendered next to the time
 *      value on the same row. On narrow screens it wraps to the next line
 *      automatically (the parent Row uses `flex-wrap`).
 *
 * UTC is treated as a "no real timezone" fallback used by the codebase when
 * a city has no timezone set - we deliberately don't surface it to users.
 */
export default function TimezoneHint({ tz, variant = 'under' }) {
  const t = useT();
  if (!tz || tz === 'UTC') return null;

  // `inline` is rendered as a block inside Row's flex-wrap parent and forced
  // to a new line via basis-full, so the TZ always sits UNDER the value on
  // every screen width (view dialogs).
  if (variant === 'inline') {
    return (
      <span className="basis-full text-xs text-muted-foreground">
        {t('common.tz_detected', { tz })}
      </span>
    );
  }

  return (
    <p className="mt-1 text-xs text-muted-foreground">
      {t('common.tz_detected', { tz })}
    </p>
  );
}