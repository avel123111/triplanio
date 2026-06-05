import React, { useState } from 'react';
import { ChevronDown, ChevronRight, ArrowRight, ExternalLink } from 'lucide-react';
import { transportInfo } from '@/lib/transport';
import { formatInTz } from '@/lib/time';
import { BOOKING_PLATFORMS, platformLogoUrl, normalizeExternalUrl } from '@/lib/booking-platforms';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

function transferDuration(startIso, endIso) {
  if (!startIso || !endIso) return '';
  const mins = Math.round((new Date(endIso) - new Date(startIso)) / 60000);
  if (mins <= 0) return '';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Read-only collapsible group rendered in place of a single transfer DayEventRow
 * when the trip contains multiple transfer segments for the same from→to pair.
 *
 * - Single segment: caller should NOT use this component (use a normal row).
 * - 2+ segments: collapsed summary plashka by default; expanded shows each segment.
 */
export default function TransferGroupReadOnly({
  fromVisit, toVisit, transfers, time, onClickTransfer,
}) {
  const { plural } = useI18nFormat();
  const sorted = [...transfers].sort((a, b) =>
    new Date(a.start_datetime || 0) - new Date(b.start_datetime || 0)
  );
  const [open, setOpen] = useState(false);

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const startTz = fromVisit?.timezone || 'UTC';
  const endTz = toVisit?.timezone || 'UTC';

  return (
    <div className="rounded-2xl bg-primary/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 p-3 hover:bg-primary/15 transition text-left"
      >
        <div className="w-12 shrink-0 text-right tabular-nums text-sm font-medium text-muted-foreground">
          {time.toFormat('HH:mm')}
        </div>
        <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
          {open ? <ChevronDown className="w-4 h-4 text-primary" /> : <ChevronRight className="w-4 h-4 text-primary" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
            <span>{fromVisit?.city_name || '-'}</span>
            <ArrowRight className="w-3 h-3 text-muted-foreground" />
            <span>{toVisit?.city_name || '-'}</span>
            <span className="text-xs text-muted-foreground font-normal">
              {plural(sorted.length, 'transfer.with_layover', { count: sorted.length })}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground flex items-center flex-wrap gap-x-1">
            <span>{first?.start_datetime ? formatInTz(first.start_datetime, startTz, 'd LLL HH:mm') : '-'}</span>
            <span>→</span>
            <span>{last?.end_datetime ? formatInTz(last.end_datetime, endTz, 'd LLL HH:mm') : '-'}</span>
            <span className="mx-1">·</span>
            {sorted.map((t, i) => {
              const info = transportInfo(t.transport_type);
              const Icon = info.Icon;
              return (
                <React.Fragment key={t.id}>
                  {i > 0 && <span className="mx-0.5">→</span>}
                  <Icon className="inline w-3 h-3 -mt-0.5" />
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-2 space-y-2 border-t border-primary/10">
          {sorted.map((t, i) => (
            <SegmentRow key={t.id} index={i + 1} transfer={t} fromVisit={fromVisit} toVisit={toVisit} onClick={() => onClickTransfer?.(t)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SegmentRow({ index, transfer, fromVisit, toVisit, onClick }) {
  const { t } = useI18nFormat();
  const info = transportInfo(transfer.transport_type);
  const Icon = info.Icon;
  const startTz = fromVisit?.timezone || 'UTC';
  const endTz = toVisit?.timezone || 'UTC';
  const platformInfo = transfer.booking_platform ? BOOKING_PLATFORMS[transfer.booking_platform] : null;
  const platformLogo = platformLogoUrl(transfer.booking_platform, transfer.booking_url);
  const dur = transferDuration(transfer.start_datetime, transfer.end_datetime);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-start gap-2 text-left rounded-xl bg-card hover:bg-secondary/50 transition p-2.5 border"
    >
      <div className="shrink-0 w-6 h-6 mt-0.5 rounded-full bg-secondary text-[10px] font-semibold flex items-center justify-center text-muted-foreground">
        {index}
      </div>
      <div className="w-8 h-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
          <span>{info.label}</span>
          {transfer.carrier && (
            <span className="text-xs text-muted-foreground font-normal">· {transfer.carrier}</span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {transfer.start_datetime ? formatInTz(transfer.start_datetime, startTz, 'd LLL HH:mm') : '-'}
          {' → '}
          {transfer.end_datetime ? formatInTz(transfer.end_datetime, endTz, 'd LLL HH:mm') : '-'}
          {dur ? ` · ${dur}` : ''}
        </div>
        {normalizeExternalUrl(transfer.booking_url) && (
          <div className="mt-1.5" onClick={(e) => e.stopPropagation()}>
            <a
              href={normalizeExternalUrl(transfer.booking_url)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-secondary hover:bg-secondary/70 border border-border transition"
            >
              {platformLogo ? <img src={platformLogo} alt="" className="w-3 h-3 rounded-sm" /> : <ExternalLink className="w-3 h-3" />}
              {platformInfo && transfer.booking_platform !== 'other' ? platformInfo.label : t('transfer.view_link_short')}
            </a>
          </div>
        )}
      </div>
    </button>
  );
}