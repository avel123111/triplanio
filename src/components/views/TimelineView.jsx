import { Button } from '@/components/ui/button';
import React, { useMemo } from 'react';
import { Plus, MapPinned, AlertTriangle, MapPin } from 'lucide-react';
import { countryFlag } from '@/lib/geo';
import CityVisitCard from '@/components/visits/CityVisitCard';
import TransferGroup from '@/components/transfers/TransferGroup';
import { sortVisits, tripWarnings } from '@/lib/validation';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

/**
 * Trip-edit timeline. Renders ordered visits with inbound transfers between
 * them and start/end anchors as compact rows.
 */
export default function TimelineView({
  trip, visits, hotels, activities, transfers,
  onAddVisit, onEditVisit, onDeleteVisit,
  onAddHotel, onEditHotel, onViewHotel,
  onAddActivity, onEditActivity, onViewActivity,
  onAddTransfer, onEditTransfer, onViewTransfer,
}) {
  const { t } = useI18nFormat();
  const ordered = useMemo(() => sortVisits(visits), [visits]);
  const warnings = useMemo(() => tripWarnings(visits, transfers, hotels, activities), [visits, transfers, hotels, activities]);

  const hotelsByVisit = useMemo(() => {
    const m = {}; hotels.forEach(h => { (m[h.city_visit_id] ||= []).push(h); }); return m;
  }, [hotels]);
  const actsByVisit = useMemo(() => {
    const m = {}; activities.forEach(a => { (m[a.city_visit_id] ||= []).push(a); }); return m;
  }, [activities]);
  const inboundByVisit = useMemo(() => {
    const m = {}; transfers.forEach(t => { (m[t.to_city_visit_id] ||= []).push(t); }); return m;
  }, [transfers]);

  if (ordered.length === 0) {
    return (
      <div className="text-center py-16 border-2 border-dashed border-border rounded-2xl bg-card">
        <MapPinned className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
        <h3 className="font-semibold mb-1">{t('visit.no_cities_title')}</h3>
        <p className="text-sm text-muted-foreground mb-4">{t('visit.no_cities_subtitle')}</p>
        <Button onClick={onAddVisit}><Plus className="w-4 h-4 mr-1.5" />{t('visit.add_first_city')}</Button>
      </div>
    );
  }

  return (
    <div>
      {warnings.length > 0 && (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive space-y-1">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{w.message}</div>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {ordered.map((visit, i) => {
          const prev = ordered[i - 1];
          const next = ordered[i + 1];
          const inbound = prev ? (inboundByVisit[visit.id] || []).filter(t => t.from_city_visit_id === prev.id) : [];

          if (visit.kind === 'start' || visit.kind === 'end') {
            return (
              <React.Fragment key={visit.id}>
                {prev && (
                  <TransferGroup
                    fromVisit={prev}
                    toVisit={visit}
                    transfers={inbound}
                    tripId={trip.id}
                    onAdd={onAddTransfer}
                    onEdit={onEditTransfer}
                    onView={onViewTransfer}
                  />
                )}
                <AnchorVisitCard visit={visit} onEdit={() => onEditVisit(visit)} onDelete={() => onDeleteVisit(visit)} />
              </React.Fragment>
            );
          }

          return (
            <React.Fragment key={visit.id}>
              {prev && (
                <TransferGroup
                  fromVisit={prev}
                  toVisit={visit}
                  transfers={inbound}
                  tripId={trip.id}
                  onAdd={onAddTransfer}
                  onEdit={onEditTransfer}
                  onView={onViewTransfer}
                />
              )}
              <CityVisitCard
                visit={visit}
                hotels={hotelsByVisit[visit.id] || []}
                activities={actsByVisit[visit.id] || []}
                // B1 fix: warn about the INBOUND gap (prev→current), matching base44
                // ReadOnlyTimelineView logic: skip start→city1, show cityN→end.
                hasNextVisit={!!prev && prev.kind !== 'start'}
                hasTransferToNext={prev && prev.kind !== 'start'
                  ? transfers.some(t => t.from_city_visit_id === prev.id && t.to_city_visit_id === visit.id)
                  : false}
                onEdit={() => onEditVisit(visit)}
                onDelete={() => onDeleteVisit(visit)}
                onAddHotel={() => onAddHotel(visit)}
                onEditHotel={(h) => onEditHotel(visit, h)}
                onViewHotel={onViewHotel}
                onAddActivity={() => onAddActivity(visit)}
                onEditActivity={(a) => onEditActivity(visit, a)}
                onViewActivity={onViewActivity}
              />
            </React.Fragment>
          );
        })}

        <button
          onClick={onAddVisit}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-dashed border-primary/50 text-primary bg-card hover:bg-primary/5 transition font-medium text-sm"
        >
          <MapPin className="w-4 h-4" />{t('visit.add_destination')}
        </button>
      </div>
    </div>
  );
}

function AnchorVisitCard({ visit, onEdit, onDelete }) {
  const { t } = useI18nFormat();
  const isStart = visit.kind === 'start';
  return (
    <div className="rounded-xl border border-border bg-card p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {isStart ? t('visit.kind_start') : t('visit.kind_end')}
        </div>
        <div className="font-semibold flex items-center gap-1.5">
          <span>{visit.city_name}{visit.country ? `, ${visit.country}` : ''}</span>
          {visit.country_code && <span className="text-lg leading-none">{countryFlag(visit.country_code)}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onEdit}>{t('common.edit')}</Button>
        <Button variant="ghost" size="sm" onClick={onDelete} className="text-destructive hover:text-destructive">{t('common.delete')}</Button>
      </div>
    </div>
  );
}