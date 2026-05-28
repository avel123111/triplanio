import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Sparkles, Smartphone, Car, ShieldCheck, ChevronRight, Plus, ChevronDown } from 'lucide-react';
import { DateTime } from 'luxon';
import ServiceDialog from '@/components/services/ServiceDialog';
import EventEditDialog from '@/components/common/EventEditDialog';
import EventModal from '@/components/common/EventModal';
import BookingChoiceDialog from '@/components/bookings/BookingChoiceDialog';
import { carRentalPlatforms, esimPlatforms } from '@/components/bookings/buildBookingPlatforms';
import { BOOKING_PLATFORMS, platformLogoUrl } from '@/lib/booking-platforms';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { usePartnerLogger } from '@/lib/partnerTracking';

const KIND_IDS = ['esim', 'car_rental', 'insurance'];
const KIND_ICONS = { esim: Smartphone, car_rental: Car, insurance: ShieldCheck };

export default function TripServicesCard({ tripId, trip = null, readOnly = false, noFrame = false, hideHeader = false }) {
  const { t } = useI18nFormat();
  const logClick = usePartnerLogger(tripId);
  const KINDS = KIND_IDS.map((id) => ({
    id,
    Icon: KIND_ICONS[id],
    label: t(`service.kind.${id}`),
    hint: t(`service.hint.${id}`)
  }));
  const KIND_MAP = Object.fromEntries(KINDS.map((k) => [k.id, k]));
  const [editDialog, setEditDialog] = useState({ open: false, kind: null, service: null });
  const [viewDialog, setViewDialog] = useState({ open: false, service: null });
  const [carChoiceOpen, setCarChoiceOpen] = useState(false);
  const [esimChoiceOpen, setEsimChoiceOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const { data: services = [] } = useQuery({
    queryKey: ['trip-services', tripId],
    queryFn: () => base44.entities.TripService.filter({ trip_id: tripId }),
    enabled: !!tripId
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['trip-visits-for-esim', tripId],
    queryFn: () => base44.entities.CityVisit.filter({ trip_id: tripId }),
    enabled: !!tripId && esimChoiceOpen
  });

  const byKind = KINDS.reduce((acc, k) => {
    acc[k.id] = services.filter((s) => s.kind === k.id);
    return acc;
  }, {});

  // Top quick-add buttons: only for kinds that have NO items yet, and only esim + car_rental.
  // Insurance "Add" lives inside "Ещё" always.
  const topAddKinds = ['esim', 'car_rental'].filter((id) => (byKind[id] || []).length === 0);

  // "Ещё" buttons: add insurance always (initial), plus add-more for esim/car_rental if they already have items.
  const moreAddKinds = [];
  if ((byKind['esim'] || []).length > 0) moreAddKinds.push('esim');
  if ((byKind['car_rental'] || []).length > 0) moreAddKinds.push('car_rental');
  moreAddKinds.push('insurance'); // always available in "Ещё"

  const openCreate = (kindId) => {
    if (readOnly) return;
    if (kindId === 'car_rental') {
      setCarChoiceOpen(true);
      return;
    }
    if (kindId === 'esim') {
      setEsimChoiceOpen(true);
      return;
    }
    setEditDialog({ open: true, kind: kindId, service: null });
  };

  const openView = (svc) => {
    setViewDialog({ open: true, service: svc });
  };

  const openEditFromView = () => {
    const svc = viewDialog.service;
    setViewDialog({ open: false, service: null });
    setEditDialog({ open: true, kind: svc.kind, service: svc });
  };

  const Wrapper = noFrame ? React.Fragment : 'div';
  const wrapperProps = noFrame ? {} : { className: 'rounded-2xl border bg-card p-4' };

  return (
    <Wrapper {...wrapperProps}>
      {!hideHeader &&
      <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-muted-foreground" />
          <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
            {t('service.header_more')}
          </span>
        </div>
      }

      <div className="-mx-5 divide-y divide-border">
        {/* Existing services as cards */}
        {services.map((svc) => {
          const k = KIND_MAP[svc.kind];
          if (!k) return null;
          const d = svc.details || {};
          const isCar = svc.kind === 'car_rental';
          const provider = isCar && d.booking_platform ? BOOKING_PLATFORMS[d.booking_platform] : null;
          const providerLabel = provider && d.booking_platform !== 'other' ? provider.label : null;
          const providerLogo = isCar ? platformLogoUrl(d.booking_platform, d.booking_url) : null;
          const pickupDt = isCar && d.pickup_at_local ? DateTime.fromISO(d.pickup_at_local) : null;
          const dropoffDt = isCar && d.dropoff_at_local ? DateTime.fromISO(d.dropoff_at_local) : null;
          const datesLine = pickupDt && pickupDt.isValid && dropoffDt && dropoffDt.isValid ?
          `${pickupDt.toFormat('d LLL')} → ${dropoffDt.toFormat('d LLL')}` :
          null;

          return (
            <button
              key={svc.id}
              type="button"
              onClick={() => openView(svc)}
              className="w-full flex items-start gap-2.5 px-5 py-3 hover:bg-secondary/40 transition text-left">
              
              <div className="w-9 h-9 bg-secondary text-violet-700 dark:text-violet-300 flex items-center justify-center shrink-0 rounded-[5px]">
                <k.Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{k.label}</div>
                <div className="truncate text-[11px] text-muted-foreground">{svc.name}</div>
                {isCar && (providerLabel || datesLine) &&
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
                    {providerLogo && <img src={providerLogo} alt="" className="w-3.5 h-3.5 rounded-sm shrink-0" />}
                    {providerLabel && <span className="truncate">{providerLabel}</span>}
                    {providerLabel && datesLine && <span>·</span>}
                    {datesLine && <span className="truncate">{datesLine}</span>}
                  </div>
                }
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
            </button>);

        })}

        {/* Top quick-add buttons for not-yet-added eSIM / Car rental */}
        {!readOnly && topAddKinds.map((id) => {
          const k = KIND_MAP[id];
          return (
            <button
              key={`add-${id}`}
              type="button"
              onClick={() => openCreate(id)}
              className="w-full flex items-center gap-2.5 px-5 py-3 hover:bg-secondary/40 transition text-left">
              
              <div className="w-9 h-9 bg-secondary text-muted-foreground flex items-center justify-center shrink-0 rounded-[5px]">
                <k.Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{k.label}</div>
                <div className="text-[11px] text-muted-foreground truncate">{k.hint}</div>
              </div>
              <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
            </button>);

        })}

        {/* "Ещё" expandable section */}
        {!readOnly &&
        <div>
            <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            className="w-full flex items-center gap-2.5 px-5 py-3 hover:bg-secondary/40 transition text-left">
            
              <div className="w-9 h-9 bg-secondary text-muted-foreground flex items-center justify-center shrink-0 rounded-[5px]">
                <Plus className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{t('service.more')}</div>
                <div className="text-[11px] text-muted-foreground truncate">{t('service.more_hint')}</div>
              </div>
              <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
            </button>

            {moreOpen &&
          <div className="mt-2 space-y-2 pl-2 border-l-2 border-border ml-2">
                {moreAddKinds.map((id) => {
              const k = KIND_MAP[id];
              const hasItems = (byKind[id] || []).length > 0;
              return (
                <button
                  key={`more-${id}`}
                  type="button"
                  onClick={() => openCreate(id)}
                  className="w-full flex items-center gap-2.5 p-2.5 rounded-lg border border-border bg-card hover:bg-secondary/50 transition text-left">
                  
                      <div className="w-8 h-8 bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 flex items-center justify-center shrink-0 rounded-[5px]">
                        <k.Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {hasItems ? t('service.add_more', { label: k.label }) : t('service.add_one', { label: k.label })}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">{k.hint}</div>
                      </div>
                      <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
                    </button>);

            })}
              </div>
          }
          </div>
        }
      </div>

      {/* Edit: car_rental gets the unified rich dialog; other service kinds
          (esim, insurance) stay on the simple name+price ServiceDialog. */}
      {editDialog.kind === 'car_rental' ? (
        <EventEditDialog
          open={editDialog.open}
          onOpenChange={(o) => setEditDialog((d) => ({ ...d, open: o }))}
          kind="service"
          tripId={tripId}
          entity={editDialog.service}
        />
      ) : (
        <ServiceDialog
          open={editDialog.open}
          onOpenChange={(o) => setEditDialog((d) => ({ ...d, open: o }))}
          tripId={tripId}
          kind={editDialog.kind}
          service={editDialog.service}
        />
      )}

      <EventModal
        open={viewDialog.open}
        onOpenChange={(o) => setViewDialog((d) => ({ ...d, open: o }))}
        entity={viewDialog.service}
        kind="service"
        onEdit={readOnly ? undefined : openEditFromView}
        readOnly={readOnly}
      />


      <BookingChoiceDialog
        open={carChoiceOpen}
        onOpenChange={setCarChoiceOpen}
        title={t('service.car_choice_title')}
        description={t('service.car_choice_desc')}
        manualLabel={t('service.car_choice_manual')}
        manualHint={t('service.car_choice_manual_hint')}
        onManual={() => setEditDialog({ open: true, kind: 'car_rental', service: null })}
        onPlatformClick={(p) => logClick({ partner: p.key, type: 'carrental', link: p.url })}
        platforms={carRentalPlatforms(trip, t)} />

      <BookingChoiceDialog
        open={esimChoiceOpen}
        onOpenChange={setEsimChoiceOpen}
        title={t('service.esim_choice_title')}
        description={t('service.esim_choice_desc')}
        manualLabel={t('service.esim_choice_manual')}
        manualHint={t('service.esim_choice_manual_hint')}
        onManual={() => setEditDialog({ open: true, kind: 'esim', service: null })}
        onPlatformClick={(p) => logClick({ partner: p.key, type: 'esim', link: p.url })}
        platforms={esimPlatforms(visits, t)} />
      
    </Wrapper>);

}