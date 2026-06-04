import React, { useMemo } from 'react';
import { sortVisits } from '@/lib/validation';
import { countryFlag } from '@/lib/geo';
import { uniqueCityCount } from '@/lib/trip-cities';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { parseNaive } from '@/lib/naive-time';

/**
 * "Trip summary" card: full route - all cities in order with local dates.
 */
export default function TripSummary({ visits = [], noFrame = false, hideHeader = false }) {
  const { t, plural, locale } = useI18nFormat();
  const ordered = useMemo(() => sortVisits(visits), [visits]);
  const cityCount = useMemo(() => uniqueCityCount(ordered), [ordered]);

  if (ordered.length === 0) return null;

  const Wrapper = noFrame ? React.Fragment : 'div';
  const wrapperProps = noFrame ? {} : { className: 'rounded-2xl border border-border bg-card p-4' };

  return (
    <Wrapper {...wrapperProps}>
      {!hideHeader && (
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
            {t('trip.sidebar_route')}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {cityCount} {plural(cityCount, 'trip.cities_count')}
          </div>
        </div>
      )}
      <ol>
        {ordered.map((v, i) => (
          <li key={v.id}>
            <RouteRow
              visit={v}
              index={i + 1}
              isLast={i === ordered.length - 1}
              locale={locale}
              plural={plural}
            />
          </li>
        ))}
      </ol>
    </Wrapper>
  );
}

function RouteRow({ visit, index, isLast, locale, plural }) {
  // Naive wall-clock - visit.timezone is intentionally ignored.
  const start = parseNaive(visit.start_date)?.setLocale(locale) || null;
  const end = parseNaive(visit.end_date)?.setLocale(locale) || null;

  const sameDay = start && end && start.hasSame(end, 'day');
  const range = start && end
    ? (sameDay ? start.toFormat('d LLL') : `${start.toFormat('d LLL')} → ${end.toFormat('d LLL')}`)
    : start ? start.toFormat('d LLL') : '';

  const nights = start && end
    ? Math.max(0, Math.round(end.startOf('day').diff(start.startOf('day'), 'days').days))
    : 0;

  return (
    <div className="relative flex items-stretch gap-3">
      {/* index marker column - vertical line passes through circle center */}
      <div className="relative shrink-0 w-7 flex flex-col items-center">
        <div className="w-7 h-7 rounded-full bg-card border border-border flex items-center justify-center text-xs font-medium text-muted-foreground shrink-0">
          {index}
        </div>
        {!isLast && (
          <div className="flex-1 w-px bg-border my-1" />
        )}
      </div>

      {/* content */}
      <div className={`flex-1 min-w-0 py-1 ${!isLast ? 'border-b border-border' : ''} pb-3 mb-2`}>
        <div className="flex items-center gap-1.5 text-sm font-bold leading-tight">
          <span className="truncate">{visit.city_name}</span>
          <span>{countryFlag(visit.country_code)}</span>
        </div>
        {visit.country && (
          <div className="text-xs text-muted-foreground mt-1">{visit.country}</div>
        )}
        {range && (
          <div className="text-xs text-muted-foreground mt-0.5">
            {range}
            {nights > 0 && <span className="ml-1.5">· {nights} {plural(nights, 'trip.nights')}</span>}
          </div>
        )}
      </div>
    </div>
  );
}