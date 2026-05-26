import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, ArrowRight, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import TransferStrip from './TransferStrip';
import { transportInfo } from '@/lib/transport';
import { formatInTz } from '@/lib/time';
import { transferGroupWarnings } from '@/lib/validation';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

const MAX_TRANSFERS = 3;

/**
 * Group of one or more transfers between two cities.
 * - 1 transfer  → renders the single TransferStrip as-is (with "add segment" button below).
 * - 2-3         → collapsible summary plashka. Expanded view shows each segment as a TransferStrip.
 */
export default function TransferGroup({ fromVisit, toVisit, transfers, tripId, onAdd, onEdit, onView }) {
  const { t, plural } = useI18nFormat();
  const sorted = [...transfers].sort((a, b) =>
    new Date(a.start_datetime || 0) - new Date(b.start_datetime || 0)
  );
  const [expanded, setExpanded] = useState(sorted.length === 1);

  if (sorted.length === 0) {
    return (
      <TransferStrip
        fromVisit={fromVisit}
        toVisit={toVisit}
        transfer={null}
        tripId={tripId}
        onAdd={onAdd}
        onEdit={onEdit}
        onView={onView}
      />
    );
  }

  // Single transfer — render as before, with a small "+ пересадка" affordance below.
  if (sorted.length === 1) {
    return (
      <div className="space-y-2">
        <TransferStrip
          fromVisit={fromVisit}
          toVisit={toVisit}
          transfer={sorted[0]}
          tripId={tripId}
          onAdd={onAdd}
          onEdit={onEdit}
          onView={onView}
        />
        <button
          type="button"
          onClick={() => onAdd(fromVisit, toVisit)}
          className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-secondary transition"
        >
          <Plus className="w-3 h-3" />{t('transfer.add_layover')}
        </button>
      </div>
    );
  }

  // 2-3 segments — render collapsible group plashka.
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const startTz = fromVisit.timezone || 'UTC';
  const endTz = toVisit.timezone || 'UTC';
  const warns = transferGroupWarnings(sorted, fromVisit, toVisit);

  return (
    <div className="rounded-xl bg-primary/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 p-3 hover:bg-primary/15 transition text-left"
      >
        <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-primary" /> : <ChevronRight className="w-4 h-4 text-primary" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
            <span>{fromVisit.city_name}</span>
            <ArrowRight className="w-3 h-3 text-muted-foreground" />
            <span>{toVisit.city_name}</span>
            <span className="text-xs text-muted-foreground font-normal">
              {plural(sorted.length, 'transfer.with_layover', { count: sorted.length })}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {first.start_datetime ? formatInTz(first.start_datetime, startTz, 'd LLL HH:mm') : '—'}
            {' → '}
            {last.end_datetime ? formatInTz(last.end_datetime, endTz, 'd LLL HH:mm') : '—'}
            {' · '}
            {sorted.map((t, i) => {
              const info = transportInfo(t.transport_type);
              const Icon = info.Icon;
              return (
                <React.Fragment key={t.id}>
                  {i > 0 && <span className="mx-1">→</span>}
                  <Icon className="inline w-3 h-3 -mt-0.5" />
                </React.Fragment>
              );
            })}
          </div>
        </div>
        {warns.length > 0 && <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-primary/10 pt-3">
          {sorted.map((t, i) => (
            <div key={t.id} className="flex items-start gap-2">
              <div className="shrink-0 w-6 h-6 mt-2 rounded-full bg-card border text-[10px] font-semibold flex items-center justify-center text-muted-foreground">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <TransferStrip
                  fromVisit={fromVisit}
                  toVisit={toVisit}
                  transfer={t}
                  tripId={tripId}
                  onAdd={onAdd}
                  onEdit={onEdit}
                  onView={onView}
                />
              </div>
            </div>
          ))}
          {warns.length > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive space-y-1">
              {warns.map((w, i) => (
                <div key={i} className="flex items-start gap-1.5"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{w}</div>
              ))}
            </div>
          )}
          {sorted.length < MAX_TRANSFERS && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onAdd(fromVisit, toVisit)}
              className="text-xs w-full justify-center"
            >
              <Plus className="w-3 h-3 mr-1" />{t('transfer.add_layover')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}