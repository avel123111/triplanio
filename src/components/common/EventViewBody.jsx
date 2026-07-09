/**
 * EventViewBody - SHARED read-view layer for a timeline event
 * (hotel / transfer / activity / car-rental service).
 *
 * One logic, two shells: this module owns the per-kind display computation
 * (`useEventViewModel`), the document state + inline upload (`useEntityDocs`)
 * and the section renderer (`EventViewSections`). Both the Dialog shell
 * (`EventModal`) and the in-place left-panel shell (trip-editor panels)
 * render the SAME sections, so a fix here lands in both surfaces.
 *
 * Chrome that legitimately differs between shells (Dialog header + meta strip
 * + footer vs PanelShell back-button + footer) stays in each shell; the shared
 * view-model exposes the derived values both shells need to build it.
 */
import React, { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useToast } from '@/design/index';
import { supabase } from '@/api/supabaseClient';
import { parseNaive } from '@/lib/naive-time';
import { fmtMoneyActive } from '@/lib/i18n/format';
import { utcToLocalInput } from '@/lib/time';
import { getEntityDocuments, getDetailsDocuments } from '@/lib/documents';
import { optimisticContentUpdate, invalidateTripData } from '@/lib/trip-data';
import { uploadTripFiles, persistEntityDocuments } from '@/lib/documentMutations';
import { removeTripFiles } from '@/lib/storageCleanup';
import { faviconUrl, hostnameFromUrl } from '@/lib/booking-platforms';
import { cityLabel } from '@/lib/trip-cities';
import { validateEntity } from '@/lib/validation';

// Raw city_visits rows carry no `city_name` column (dropped in Phase 6). Resolve the
// localized label into an in-memory `city_name` slot so verdict text reads "…в Барселона"
// not "…в undefined". One helper reused at every seam (load + display).
const withCityName = (v, lang) => (v ? { ...v, city_name: v.city_name || cityLabel(v, lang) } : v);
import {
  Map as MapIcon, Calendar, FileText,
  BedDouble, Plane, Train, Bus, Car as CarIcon, Ship, Footprints, Ticket,
  ShieldCheck, Phone, Mail, Hash, ExternalLink, Check, Moon, ArrowRight,
} from 'lucide-react';
import { CardSim } from '@/design/icons';

export const TRANSPORT_ICONS = {
  plane: Plane, train: Train, bus: Bus, car: CarIcon, taxi: CarIcon,
  ferry: Ship, walk: Footprints, own_transport: CarIcon, other: CarIcon,
};

export function eventTheme(kind, entity) {
  if (kind === 'hotel') {
    return { color: 'var(--ev-hotel)', soft: 'var(--ev-hotel-soft)', ink: 'var(--ev-hotel-ink)', Icon: BedDouble, labelKey: 'budget.cat_accommodation' };
  }
  if (kind === 'activity') {
    return { color: 'var(--ev-activity)', soft: 'var(--ev-activity-soft)', ink: 'var(--ev-activity-ink)', Icon: Ticket, labelKey: 'budget.source_activity' };
  }
  if (kind === 'service') {
    if (entity?.kind === 'esim') {
      return { color: 'var(--ev-esim)', soft: 'var(--ev-esim-soft)', ink: 'var(--ev-esim-ink)', Icon: CardSim, labelKey: 'service.kind.esim' };
    }
    if (entity?.kind === 'insurance') {
      return { color: 'var(--ev-insurance)', soft: 'var(--ev-insurance-soft)', ink: 'var(--ev-insurance-ink)', Icon: ShieldCheck, labelKey: 'service.kind.insurance' };
    }
    return { color: 'var(--ev-car)', soft: 'var(--ev-car-soft)', ink: 'var(--ev-car-ink)', Icon: CarIcon, labelKey: 'service.car_default_name' };
  }
  // transfer
  const tt = entity?.transport_type;
  const Icon = TRANSPORT_ICONS[tt] || Plane;
  return {
    color: 'var(--ev-transfer)', soft: 'var(--ev-transfer-soft)', ink: 'var(--ev-transfer-ink)',
    Icon, labelKey: tt === 'plane' ? 'trip.tl_flight' : 'trip.tl_transfer',
  };
}

export function fmtDT(iso) {
  const d = parseNaive(iso);
  return d ? d.toFormat('d MMM, HH:mm') : '';
}
export function fmtDate(iso) {
  const d = parseNaive(iso);
  return d ? d.toFormat('d MMM') : '';
}
export function fmtTime(iso) {
  const d = parseNaive(iso);
  return d ? d.toFormat('HH:mm') : '';
}
export function fmtPrice(price, cur, opts) {
  if (price == null || price === '') return '';
  return fmtMoneyActive(Number(price), cur || 'EUR', opts);
}
// Calendar nights between check-in and check-out (clock-time independent).
// Shared by both hotel view shells (dialog EventViewBody + panel EventPanels).
export function stayNights(checkInIso, checkOutIso) {
  const ci = parseNaive(checkInIso);
  const co = parseNaive(checkOutIso);
  return (ci && co) ? Math.max(0, Math.round(co.startOf('day').diff(ci.startOf('day'), 'days').days)) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Section primitives (3px accent bar + body)
// ─────────────────────────────────────────────────────────────────────────────

export function Section({ title, accent, count, children }) {
  return (
    <div className="ev-sec" style={accent ? { '--ev-color': accent } : undefined}>
      <div className="ev-sec-lbl">
        {title}{count != null && count > 0 ? ` · ${count}` : ''}
      </div>
      {children}
    </div>
  );
}

export function KV({ label, children, mono }) {
  if (children == null || children === '') return null;
  return (
    <div className="kv">
      <div className="k">{label}</div>
      <div className={mono ? 'v mono' : 'v'}>{children}</div>
    </div>
  );
}

function paymentLabel(t, status) {
  if (status === 'paid') return t('event.paid');
  if (status === 'partial') return t('event.partial');
  if (status === 'pay_on_arrival') return t('event.on_arrival');
  return status || null;
}

// Payment status as a Lumo badge (design: badge--paid / --partial / --on-arrival).
function PaymentBadge({ t, status }) {
  const label = paymentLabel(t, status);
  if (!label) return null;
  const cls = status === 'paid' ? 'badge--paid'
    : status === 'partial' ? 'badge--partial'
    : status === 'pay_on_arrival' ? 'badge--on-arrival' : 'badge--quiet';
  return <span className={`badge ${cls}`}>{label}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Per-kind body
// ─────────────────────────────────────────────────────────────────────────────

// Hotel view — canonical card-based layout (TRIP-176 redesign). Name card
// (name + address + platform pill), labelled sections wrapping bordered cards,
// booking details as a row list. Renders its own docs + notes (new style), so
// EventViewSections skips the shared docs/notes for the hotel kind.
function HotelBody({ entity, docs = [] }) {
  const { t } = useI18n();
  const nights = stayNights(entity.check_in_datetime, entity.check_out_datetime);
  const bookingUrl = entity.booking_url;
  const platformName = hostnameFromUrl(bookingUrl);
  const platformLogo = faviconUrl(bookingUrl);
  const priceText = fmtPrice(entity.price, entity.currency);
  // TRIP-186: цена за ночь сокращается компактно, как в чипах отелей на карте.
  const perNight = (priceText && nights > 0) ? fmtPrice(Number(entity.price) / nights, entity.currency, { compact: true }) : null;
  const notes = entity.notes;
  return (
    <div className="hv">
      {/* Name card */}
      <div className="hv-namecard">
        <div className="hv-name t-title">{entity.name}</div>
        {entity.address && (
          <div className="hv-addr t-meta"><MapIcon size={13} /><span>{entity.address}</span></div>
        )}
        {bookingUrl && (
          <div className="hv-plat">
            <span className="hv-plat__ic">
              {platformLogo ? <img src={platformLogo} alt="" /> : (platformName ? platformName[0].toUpperCase() : '?')}
            </span>
            <span className="hv-plat__nm t-meta">{t('event.booked_on', { platform: platformName || '—' })}</span>
          </div>
        )}
      </div>

      {/* Stay dates */}
      {(entity.check_in_datetime || entity.check_out_datetime) && (
        <div className="hv-sec">
          <div className="hv-lbl eyebrow">{t('event.stay_dates')}</div>
          <div className="stay-dates">
            <div className="stay-dates__cell">
              <div className="stay-dates__lbl eyebrow">{t('trip.hotel_check_in')}</div>
              <div className="stay-dates__v t-strong">{fmtDate(entity.check_in_datetime)}</div>
              <div className="stay-dates__t t-meta">{fmtTime(entity.check_in_datetime)}</div>
            </div>
            <div className="stay-dates__mid">
              <Calendar size={14} style={{ color: 'var(--muted-2)' }} />
              {nights != null && <span className="t-meta">{t('fork.stay22_nights', { count: nights })}</span>}
            </div>
            <div className="stay-dates__cell">
              <div className="stay-dates__lbl eyebrow">{t('trip.hotel_check_out')}</div>
              <div className="stay-dates__v t-strong">{fmtDate(entity.check_out_datetime)}</div>
              <div className="stay-dates__t t-meta">{fmtTime(entity.check_out_datetime)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Cost */}
      {priceText && (
        <div className="hv-sec">
          <div className="hv-lbl eyebrow">{t('event.cost')}</div>
          <div className="hv-card hv-cost">
            <div className="hv-cost__main">
              <div className="hv-price t-heading">{priceText}</div>
              {perNight && <div className="hv-pernight t-meta">{perNight} / {t('view.nights_one')}</div>}
            </div>
            <PaymentBadge t={t} status={entity.payment_status} />
          </div>
        </div>
      )}

      {/* Free cancellation */}
      {entity.free_cancellation && (
        <div className="hv-cancel">
          <span className="hv-cancel__ic"><Check /></span>
          <span className="hv-cancel__tx t-strong">
            {entity.free_cancellation_until
              ? `${t('event.free_cancel_until')} ${fmtDate(entity.free_cancellation_until)}`
              : t('event.free_cancel_have')}
          </span>
        </div>
      )}

      {/* Booking details */}
      {(entity.booking_reference || entity.phone || entity.email || bookingUrl) && (
        <div className="hv-sec">
          <div className="hv-lbl eyebrow">{t('event.booking_details')}</div>
          <div className="hv-rows">
            {entity.booking_reference && (
              <div className="hv-row">
                <span className="hv-row__ic"><Hash /></span>
                <span className="hv-row__k t-meta">{t('event.booking_ref')}</span>
                <span className="hv-row__sp" />
                <span className="hv-row__v t-strong mono">{entity.booking_reference}</span>
              </div>
            )}
            {entity.phone && (
              <div className="hv-row">
                <span className="hv-row__ic"><Phone /></span>
                <span className="hv-row__k t-meta">{t('event.phone')}</span>
                <span className="hv-row__sp" />
                <span className="hv-row__v t-strong">{entity.phone}</span>
              </div>
            )}
            {entity.email && (
              <div className="hv-row">
                <span className="hv-row__ic"><Mail /></span>
                <span className="hv-row__k t-meta">E-mail</span>
                <span className="hv-row__sp" />
                <a className="hv-row__v t-strong" href={`mailto:${entity.email}`} style={{ color: 'var(--primary)' }}>{entity.email}</a>
              </div>
            )}
            {bookingUrl && (
              <a className="hv-row hv-row--link" href={bookingUrl} target="_blank" rel="noreferrer">
                <span className="hv-row__ic"><ExternalLink /></span>
                <span className="hv-row__lbl t-ui">{t('event.view_booking')}</span>
                <ExternalLink size={15} style={{ color: 'var(--muted-2)' }} />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Documents */}
      {docs.length > 0 && (
        <div className="hv-sec">
          <div className="hv-lbl eyebrow">{t('activity.documents_label')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {docs.map((d, i) => (
              <a key={`${d.file_url}-${i}`} href={d.file_url} target="_blank" rel="noreferrer" className="doc-row">
                <div className="di"><FileText /></div>
                <b>{d.file_name || t('event.file_word')}</b>
                {d.file_size && <span className="ds">{d.file_size}</span>}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {notes && (
        <div className="hv-sec">
          <div className="hv-lbl eyebrow">{t('activity.view_notes')}</div>
          <div className="hv-notes t-body">{notes}</div>
        </div>
      )}
    </div>
  );
}

// Departure→arrival duration for the view rail (naive-time, same keys as edit fmtDur).
function transferDur(startIso, endIso, t) {
  const s = parseNaive(startIso), e = parseNaive(endIso);
  if (!s || !e) return '';
  const m = Math.max(0, Math.round(e.diff(s, 'minutes').minutes));
  const h = Math.floor(m / 60), mm = m % 60;
  const parts = [];
  if (h) parts.push(t('event.dur_h', { h }));
  if (mm || !h) parts.push(t('event.dur_m', { m: mm }));
  return parts.join(' ');
}

// Transfer view — canonical rail (dots + dashed connector + carrier avatar) with
// eyebrow type/night chips; cost/booking-details/docs/notes reuse the hotel .hv-*
// cards. Renders its own docs+notes, so EventViewSections skips the shared ones.
function TransferBody({ entity, fromVisit, toVisit, docs = [] }) {
  const { t, lang } = useI18n();
  const fromCity = cityLabel(fromVisit, lang);
  const toCity = cityLabel(toVisit, lang);
  const Ic = TRANSPORT_ICONS[entity.transport_type] || Plane;
  const night = !!entity.day_change;
  const typeCap = t(entity.transport_type === 'plane' ? 'trip.tl_flight' : 'trip.tl_transfer');
  const dur = transferDur(entity.start_datetime, entity.end_datetime, t);
  const carrier = entity.carrier || '';
  const priceText = fmtPrice(entity.price, entity.currency);
  const hasDetails = entity.booking_reference || carrier || entity.flight_number || entity.booking_url;
  const notes = entity.notes;
  return (
    <div className="tv">
      {/* Route rail */}
      <div className="tv-card">
        <div className="tv-eyebrows">
          <span className="tv-chip tv-chip--type"><Ic /><span className="t-micro">{typeCap}</span></span>
          {night && <span className="tv-chip tv-chip--night"><Moon /><span className="t-micro">{t('event.transfer_night_plus1')}</span></span>}
        </div>
        <div className="tv-route">
          <div className="tv-when">
            <div className="tv-when__t t-strong">{fmtTime(entity.start_datetime)}</div>
            <div className="tv-when__d t-meta">{fmtDate(entity.start_datetime)}</div>
          </div>
          <div className="tv-nodecell"><span className="tv-node tv-node--from" /></div>
          <div className="tv-loc tv-loc--from">
            {fromCity && <div className="tv-loc__c t-strong">{fromCity}</div>}
            {entity.from_address && <div className="tv-loc__a t-meta">{entity.from_address}</div>}
          </div>

          <div className="tv-durcell">{dur && <span className="tv-dur t-meta">{dur}</span>}</div>
          <div className="tv-conncell"><span className="tv-conn" /></div>
          <div className="tv-carrier">
            {carrier && (
              <>
                <span className="tv-carrier__av t-micro">{carrier[0].toUpperCase()}</span>
                <span className="tv-carrier__nm t-body">{carrier}</span>
              </>
            )}
          </div>

          <div className="tv-when">
            <div className="tv-arr">
              <span className="tv-when__t t-strong">{fmtTime(entity.end_datetime)}</span>
              {night && <span className="tv-plus1 t-meta">+1</span>}
            </div>
            <div className="tv-when__d t-meta">{fmtDate(entity.end_datetime)}</div>
          </div>
          <div className="tv-nodecell"><span className="tv-node tv-node--to" /></div>
          <div className="tv-loc tv-loc--to">
            {toCity && <div className="tv-loc__c t-strong">{toCity}</div>}
            {entity.to_address && <div className="tv-loc__a t-meta">{entity.to_address}</div>}
          </div>
        </div>
      </div>

      {/* Cost */}
      {priceText && (
        <div className="hv-sec">
          <div className="hv-lbl eyebrow">{t('event.cost')}</div>
          <div className="hv-card hv-cost">
            <div className="hv-cost__main">
              <div className="hv-price t-heading">{priceText}</div>
              <div className="hv-pernight t-meta">{t('event.for_whole_transfer')}</div>
            </div>
            <PaymentBadge t={t} status={entity.payment_status} />
          </div>
        </div>
      )}

      {/* Booking details */}
      {hasDetails && (
        <div className="hv-sec">
          <div className="hv-lbl eyebrow">{t('event.booking_details')}</div>
          <div className="hv-rows">
            {entity.booking_reference && (
              <div className="hv-row">
                <span className="hv-row__ic"><Hash /></span>
                <span className="hv-row__k t-meta">{t('event.booking_ref')}</span>
                <span className="hv-row__sp" />
                <span className="hv-row__v t-strong mono">{entity.booking_reference}</span>
              </div>
            )}
            {carrier && (
              <div className="hv-row">
                <span className="hv-row__ic"><Ic /></span>
                <span className="hv-row__k t-meta">{t('transfer.carrier')}</span>
                <span className="hv-row__sp" />
                <span className="hv-row__v t-strong">{carrier}</span>
              </div>
            )}
            {entity.flight_number && (
              <div className="hv-row">
                <span className="hv-row__ic"><Ticket /></span>
                <span className="hv-row__k t-meta">{t('event.flight_number')}</span>
                <span className="hv-row__sp" />
                <span className="hv-row__v t-strong mono">{entity.flight_number}</span>
              </div>
            )}
            {/* TRIP-176: ссылка на бронь в transfer view (была только в hotel/activity) */}
            {entity.booking_url && (
              <a className="hv-row hv-row--link" href={entity.booking_url} target="_blank" rel="noreferrer">
                <span className="hv-row__ic"><ExternalLink /></span>
                <span className="hv-row__lbl t-ui">{t('event.view_booking')}</span>
                <ExternalLink size={15} style={{ color: 'var(--muted-2)' }} />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Documents */}
      {docs.length > 0 && (
        <div className="hv-sec">
          <div className="hv-lbl eyebrow">{t('activity.documents_label')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {docs.map((d, i) => (
              <a key={`${d.file_url}-${i}`} href={d.file_url} target="_blank" rel="noreferrer" className="doc-row">
                <div className="di"><FileText /></div>
                <b>{d.file_name || t('event.file_word')}</b>
                {d.file_size && <span className="ds">{d.file_size}</span>}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {notes && (
        <div className="hv-sec">
          <div className="hv-lbl eyebrow">{t('activity.view_notes')}</div>
          <div className="hv-notes t-body">{notes}</div>
        </div>
      )}
    </div>
  );
}

// Activity view — canonical card layout (TRIP-176), consistent with hotel/transfer:
// date summary (start · duration · end), meeting-point card, cost card, docs+notes.
function ActivityBody({ entity, docs = [] }) {
  const { t } = useI18n();
  const dur = transferDur(entity.start_datetime, entity.end_datetime, t);
  const priceText = fmtPrice(entity.price, entity.currency);
  const notes = entity.notes;
  return (
    <div className="hv">
      {(entity.start_datetime || entity.end_datetime) && (
        <div className="hv-sec">
          <div className="hv-lbl eyebrow">{t('event.when')}</div>
          <div className="stay-dates">
            <div className="stay-dates__cell">
              <div className="stay-dates__lbl eyebrow">{t('activity.start')}</div>
              <div className="stay-dates__v t-strong">{fmtDate(entity.start_datetime)}</div>
              <div className="stay-dates__t t-meta">{fmtTime(entity.start_datetime)}</div>
            </div>
            <div className="stay-dates__mid">
              <ArrowRight size={14} style={{ color: 'var(--muted-2)' }} />
              {dur && <span className="t-meta">{dur}</span>}
            </div>
            <div className="stay-dates__cell">
              <div className="stay-dates__lbl eyebrow">{t('event.end')}</div>
              <div className="stay-dates__v t-strong">{fmtDate(entity.end_datetime)}</div>
              <div className="stay-dates__t t-meta">{fmtTime(entity.end_datetime)}</div>
            </div>
          </div>
        </div>
      )}

      {entity.location_address && (
        <div className="hv-sec">
          <div className="hv-lbl eyebrow">{t('event.meeting_point')}</div>
          <div className="hv-rows">
            <div className="hv-row">
              <span className="hv-row__ic"><MapIcon /></span>
              <span className="hv-row__v t-strong" style={{ textAlign: 'left', maxWidth: 'none', whiteSpace: 'normal' }}>{entity.location_address}</span>
            </div>
          </div>
        </div>
      )}

      {priceText && (
        <div className="hv-sec">
          <div className="hv-lbl eyebrow">{t('activity.price')}</div>
          <div className="hv-card hv-cost">
            <div className="hv-cost__main"><div className="hv-price t-heading">{priceText}</div></div>
          </div>
        </div>
      )}

      {docs.length > 0 && (
        <div className="hv-sec">
          <div className="hv-lbl eyebrow">{t('activity.documents_label')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {docs.map((d, i) => (
              <a key={`${d.file_url}-${i}`} href={d.file_url} target="_blank" rel="noreferrer" className="doc-row">
                <div className="di"><FileText /></div>
                <b>{d.file_name || t('event.file_word')}</b>
                {d.file_size && <span className="ds">{d.file_size}</span>}
              </a>
            ))}
          </div>
        </div>
      )}

      {notes && (
        <div className="hv-sec">
          <div className="hv-lbl eyebrow">{t('activity.view_notes')}</div>
          <div className="hv-notes t-body">{notes}</div>
        </div>
      )}
    </div>
  );
}

function EsimBody({ entity, accent }) {
  const { t } = useI18n();
  const d = entity.details || {};
  const price = fmtPrice(entity.price, entity.currency);
  return (
    <>
      <Section title={t('service.esim_cost_section')} accent={accent}>
        <div className="kv-grid">
          <KV label={t('budget.field_amount')} mono>{price}</KV>
          <KV label={t('service.currency')}>{entity.currency}</KV>
        </div>
      </Section>
    </>
  );
}

function InsuranceBody({ entity, accent }) {
  const { t } = useI18n();
  const d = entity.details || {};
  const fmtInsDate = (iso) => {
    if (!iso) return null;
    try { return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return iso; }
  };
  const price = fmtPrice(entity.price, entity.currency);
  return (
    <>
      <Section title={t('service.insurance_section')} accent={accent}>
        <div className="kv-grid">
          {d.policy_number && <KV label={t('service.policy_number')} mono>{d.policy_number}</KV>}
          {d.date_start && <KV label={t('service.date_start')} mono>{fmtInsDate(d.date_start)}</KV>}
          {d.date_finish && <KV label={t('service.date_finish')} mono>{fmtInsDate(d.date_finish)}</KV>}
        </div>
      </Section>
      <Section title={t('service.insurance_cost_section')} accent={accent}>
        <div className="kv-grid">
          <KV label={t('budget.field_amount')} mono>{price}</KV>
          <KV label={t('service.currency')}>{entity.currency}</KV>
        </div>
      </Section>
    </>
  );
}

function ServiceBody({ entity, accent }) {
  const { t } = useI18n();
  // Route esim/insurance to their own bodies
  if (entity.kind === 'esim') return <EsimBody entity={entity} accent={accent} />;
  if (entity.kind === 'insurance') return <InsuranceBody entity={entity} accent={accent} />;
  // car_rental
  const d = entity.details || {};
  const sameLocation = !d.dropoff_address || d.dropoff_address === d.pickup_address;
  const price = entity.price ?? d.price;
  const cur = entity.currency || d.currency;
  const pickupDisplay = entity.pickup_datetime
    ? utcToLocalInput(entity.pickup_datetime, d.pickup_timezone)
    : d.pickup_at_local;
  const dropoffDisplay = entity.dropoff_datetime
    ? utcToLocalInput(entity.dropoff_datetime, d.dropoff_timezone || d.pickup_timezone)
    : d.dropoff_at_local;
  return (
    <>
      <Section title={t('service.car_pickup')} accent={accent}>
        <div className="kv-grid">
          <KV label={t('event.pickup_where')}><div>{d.pickup_address}</div></KV>
          <KV label={t('admin.notifications.when')}>{fmtDT(pickupDisplay)}</KV>
        </div>
      </Section>
      <Section title={sameLocation ? t('service.car_dropoff') : t('event.return_elsewhere')} accent={accent}>
        <div className="kv-grid">
          <KV label={t('event.pickup_where')}>
            {sameLocation ? (
              <span className="t-meta" style={{ color: 'var(--muted)' }}>{t('event.return_same')}</span>
            ) : (
              <div>{d.dropoff_address}</div>
            )}
          </KV>
          <KV label={t('admin.notifications.when')}>{fmtDT(dropoffDisplay)}</KV>
        </div>
      </Section>
      <Section title={t('event.finance_booking')} accent={accent}>
        <div className="kv-grid">
          <KV label={t('budget.field_amount')}>{fmtPrice(price, cur)}</KV>
          <KV label={t('service.car_booking_ref')} mono>{d.booking_reference}</KV>
        </div>
      </Section>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Derived view-model (shared by both shells to build their own chrome)
// ─────────────────────────────────────────────────────────────────────────────

export function useEventViewModel(kind, entity, visit, fromVisit, toVisit) {
  const { t, lang } = useI18n();
  if (!entity || !kind) return null;
  const visitCity = cityLabel(visit, lang);
  const theme = eventTheme(kind, entity);
  const themeLabel = t(theme.labelKey);

  const title = kind === 'hotel' ? entity.name
    : kind === 'activity' ? entity.title
    : kind === 'service' ? entity.name
    : (entity.carrier || (entity.flight_number ? t('event.flight_n', { number: entity.flight_number }) : themeLabel));

  const cur = (kind === 'service' ? (entity.currency || entity.details?.currency) : entity.currency) || 'EUR';
  const price = kind === 'service' ? (entity.price ?? entity.details?.price) : entity.price;

  const bookingUrl = kind === 'service' ? entity.details?.booking_url : entity.booking_url;
  // Favicon + host label are derived from the booking URL on the fly (no stored
  // column, no platform directory) — the favicon works for any domain.
  const platformLogo = faviconUrl(bookingUrl);
  const platformLabel = hostnameFromUrl(bookingUrl);

  const metaItems = [];
  if (kind === 'hotel') {
    if (entity.check_in_datetime && entity.check_out_datetime) {
      metaItems.push({ icon: Calendar, text: `${fmtDate(entity.check_in_datetime)} → ${fmtDate(entity.check_out_datetime)}` });
    }
    if (visitCity) metaItems.push({ icon: MapIcon, text: visitCity });
  } else if (kind === 'transfer') {
    if (entity.start_datetime) metaItems.push({ icon: Calendar, text: fmtDT(entity.start_datetime) });
    const route = [cityLabel(fromVisit, lang), cityLabel(toVisit, lang)].filter(Boolean).join(' → ');
    if (route) metaItems.push({ icon: MapIcon, text: route });
  } else if (kind === 'activity') {
    if (entity.start_datetime) metaItems.push({ icon: Calendar, text: fmtDT(entity.start_datetime) });
    if (visitCity) metaItems.push({ icon: MapIcon, text: visitCity });
  } else if (kind === 'service') {
    // car_rental: show pickup→dropoff date range in meta strip
    // esim/insurance: no datetime meta — they're not time-bound events
    if (entity.kind === 'car_rental') {
      const d = entity.details || {};
      const pickupMeta = entity.pickup_datetime
        ? utcToLocalInput(entity.pickup_datetime, d.pickup_timezone)
        : d.pickup_at_local;
      const dropoffMeta = entity.dropoff_datetime
        ? utcToLocalInput(entity.dropoff_datetime, d.dropoff_timezone || d.pickup_timezone)
        : d.dropoff_at_local;
      if (pickupMeta && dropoffMeta) {
        metaItems.push({ icon: Calendar, text: `${fmtDT(pickupMeta)} → ${fmtDate(dropoffMeta)}` });
      }
    }
  }
  const priceText = fmtPrice(price, cur);

  const mapAddress = kind === 'hotel' ? entity.address
    : kind === 'transfer' ? (entity.from_address || entity.to_address)
    : kind === 'activity' ? entity.location_address
    : (entity.kind === 'car_rental' ? entity.details?.pickup_address : null);

  return {
    theme, themeLabel, title, cur, price, priceText,
    bookingUrl, platformLabel, platformLogo, mapAddress, metaItems,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Entity source loader (shared by SourceViewLoader modal + editor panel)
//  Loads a row by (kind,id) plus its related city_visit(s). One loader, two
//  shells — avoids duplicating the fetch logic.
// ─────────────────────────────────────────────────────────────────────────────

export async function getEntityRow(table, id) {
  const { data, error } = await supabase.from(table).select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export function useEntitySource(kind, id, { open = true, onError, refreshKey = 0 } = {}) {
  const { lang } = useI18n();
  // State is TAGGED with the id it belongs to. A persistently-mounted consumer
  // (SourceViewLoader lives for the whole TripView) keeps this state between
  // opens, so without the tag the next open would briefly render the PREVIOUS
  // entity before the effect runs — flashing stale content and forcing a
  // remount (the "appears → disappears → appears" flicker).
  const [src, setSrc] = useState({ id: null, data: null, visit: null, fromVisit: null, toVisit: null });

  React.useEffect(() => {
    if (!open || !id) return;
    let cancelled = false;
    (async () => {
      try {
        // Gather the row AND its related city_visit(s) before publishing, so the
        // view shell mounts ONCE with complete data instead of re-laying-out in
        // two passes.
        const next = { id, data: null, visit: null, fromVisit: null, toVisit: null };
        if (kind === 'hotel') {
          next.data = await getEntityRow('hotel_stays', id);
          if (next.data?.city_visit_id) next.visit = await getEntityRow('city_visits', next.data.city_visit_id).catch(() => null);
        } else if (kind === 'transfer') {
          next.data = await getEntityRow('transfers', id);
          const [fv, tv] = await Promise.all([
            next.data?.from_city_visit_id ? getEntityRow('city_visits', next.data.from_city_visit_id).catch(() => null) : null,
            next.data?.to_city_visit_id ? getEntityRow('city_visits', next.data.to_city_visit_id).catch(() => null) : null,
          ]);
          next.fromVisit = fv; next.toVisit = tv;
        } else if (kind === 'activity') {
          next.data = await getEntityRow('activities', id);
          if (next.data?.city_visit_id) next.visit = await getEntityRow('city_visits', next.data.city_visit_id).catch(() => null);
        } else if (kind === 'service') {
          next.data = await getEntityRow('trip_services', id);
        }
        if (!cancelled) setSrc(next);
      } catch {
        if (!cancelled) onError?.();
      }
    })();
    return () => { cancelled = true; };
    // refreshKey lets callers force a re-fetch after a live edit/toggle (this hook
    // reads rows directly, not via react-query, so cache invalidation alone misses it).
  }, [open, kind, id, refreshKey]);

  // Only expose data once it belongs to the currently-requested id; otherwise the
  // consumer would render the stale previous entity until the effect resolves.
  const fresh = src.id === id;
  // Resolve the localized `city_name` ONCE here, at the load seam, so every consumer
  // (view body AND the edit dialog reached via EventSourcePanel) gets a named visit —
  // without it, transfer validation rendered "…въезда в undefined" in edit mode.
  // Memoized per source object so the returned visits keep a stable reference across
  // unrelated re-renders (safe to use in consumer effect deps).
  const visit = useMemo(() => (fresh ? withCityName(src.visit, lang) : null), [fresh, src.visit, lang]);
  const fromVisit = useMemo(() => (fresh ? withCityName(src.fromVisit, lang) : null), [fresh, src.fromVisit, lang]);
  const toVisit = useMemo(() => (fresh ? withCityName(src.toVisit, lang) : null), [fresh, src.toVisit, lang]);
  return { data: fresh ? src.data : null, visit, fromVisit, toVisit };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Documents state + inline upload (shared)
// ─────────────────────────────────────────────────────────────────────────────

export function useEntityDocs(kind, entity, canEdit) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [docs, setDocs] = useState(() => {
    if (!entity) return [];
    return kind === 'service' ? getDetailsDocuments(entity.details || {}) : getEntityDocuments(entity);
  });
  const [uploading, setUploading] = useState(false);

  React.useEffect(() => {
    if (!entity) return;
    setDocs(kind === 'service' ? getDetailsDocuments(entity.details || {}) : getEntityDocuments(entity));
  }, [entity?.id, kind]);

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || !canEdit) return;
    const tooBig = files.find((f) => f.size > 10 * 1024 * 1024);
    if (tooBig) { toast({ description: t('event.file_too_big10'), variant: 'warning' }); return; }
    setUploading(true);
    try {
      // Upload never returns a doc with an empty file_url (was `|| ''`); failed
      // uploads / missing URLs come back as errors and are surfaced, not masked.
      const { uploaded, errors } = await uploadTripFiles(entity.trip_id, files);
      for (const e of errors) {
        toast({ description: t('doc.upload_failed', { name: e.file.name }), variant: 'destructive' });
      }
      if (!uploaded.length) return;

      const COLL = { hotel: 'hotels', transfer: 'transfers', activity: 'activities', service: 'services' }[kind];
      const prevDocs = docs;
      const next = [...docs, ...uploaded];

      // Optimistic: local state AND the trip-content cache. Both must roll back
      // together on failure, else they diverge (this is the whole risk here).
      setDocs(next);
      if (entity.trip_id && COLL) {
        const patch = kind === 'service'
          ? { id: entity.id, details: { ...(entity.details || {}), documents: next } }
          : { id: entity.id, documents: next };
        optimisticContentUpdate(qc, entity.trip_id, COLL, 'update', patch);
      }

      try {
        // Throws on a real error OR a silent 0-row RLS reject.
        await persistEntityDocuments(kind, entity, next);
      } catch {
        // Roll back BOTH optimistic sources, sweep the just-uploaded orphans,
        // and tell the user — never leave a phantom attachment in the UI.
        setDocs(prevDocs);
        if (entity.trip_id && COLL) {
          const revert = kind === 'service'
            ? { id: entity.id, details: { ...(entity.details || {}), documents: prevDocs } }
            : { id: entity.id, documents: prevDocs };
          optimisticContentUpdate(qc, entity.trip_id, COLL, 'update', revert);
        }
        removeTripFiles(uploaded.map((u) => u.storage_path));
        toast({ description: t('doc.attach_failed'), variant: 'destructive' });
        return;
      }
      if (entity.trip_id) invalidateTripData(qc, entity.trip_id);
    } finally {
      setUploading(false);
    }
  }

  return { docs, uploading, uploadFiles };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Section renderer: per-kind body + Documents + Notes (no chrome)
// ─────────────────────────────────────────────────────────────────────────────

// View-side verdict: run the SAME validation engine on the SAVED row so the read
// view shows the same logical warnings as the editor (out-of-bounds vs city
// dates, transfer day mismatch, wrong date order). Maps DB columns → engine
// draft exactly like validateTrip does. `*_REQUIRED` and empty-structure codes
// are dropped — a read pane shouldn't nag "fill the name"; only real logical
// inconsistencies surface.
const VIEW_ISSUE_SKIP = /(_REQUIRED$|^SEG_MIN$|^TR_NO_CITY$|^SEG_CITY_)/;
export function entityViewIssues(kind, entity, { visit, fromVisit, toVisit } = {}) {
  if (!entity) return [];
  let raw = [];
  if (kind === 'hotel') {
    raw = validateEntity('hotel', { id: entity.id, name: entity.name, checkIn: entity.check_in_datetime, checkOut: entity.check_out_datetime }, { visit });
  } else if (kind === 'activity') {
    raw = validateEntity('activity', { id: entity.id, title: entity.title || entity.name, start: entity.start_datetime, end: entity.end_datetime || entity.start_datetime }, { visit });
  } else if (kind === 'transfer') {
    raw = validateEntity('transfer', { id: entity.id, start: entity.start_datetime, end: entity.end_datetime }, { fromVisit, toVisit });
  } else if (kind === 'service') {
    raw = validateEntity('service', {
      id: entity.id, service_kind: entity.kind || 'car_rental', name: entity.name, isEdit: true,
      pickup: entity.pickup_datetime, dropoff: entity.dropoff_datetime,
      date_start: entity.date_start || null, date_finish: entity.date_finish || null,
    }, {});
  }
  return raw.filter((i) => !VIEW_ISSUE_SKIP.test(i.code));
}

export function EventViewSections({ kind, entity, visit, fromVisit, toVisit, accent, docs, canEdit, uploading, uploadFiles, externalWarning = null }) {
  const { t, lang } = useI18n();
  // One banner: an explicit message from the caller (editor structural conflict)
  // plus the engine verdicts on this saved row, deduped by resolved text. Visits are
  // run through withCityName so verdicts read "…из Барселона", not "…из undefined".
  const warnings = [];
  if (externalWarning) warnings.push(externalWarning);
  for (const i of entityViewIssues(kind, entity, { visit: withCityName(visit, lang), fromVisit: withCityName(fromVisit, lang), toVisit: withCityName(toVisit, lang) })) {
    const msg = t(`validation.${i.code}`, i.values);
    if (msg && !warnings.includes(msg)) warnings.push(msg);
  }
  return (
    <>
      {warnings.length > 0 && (
        <div className="warn-banner">
          <span>⚠️</span>
          <div>{warnings.map((w, k) => <div key={k}>{w}</div>)}</div>
        </div>
      )}
      {kind === 'hotel' && <HotelBody entity={entity} docs={docs} />}
      {kind === 'transfer' && <TransferBody entity={entity} fromVisit={fromVisit} toVisit={toVisit} docs={docs} />}
      {kind === 'activity' && <ActivityBody entity={entity} docs={docs} />}
      {kind === 'service' && <ServiceBody entity={entity} accent={accent} />}

      {/* Documents — view is READ-ONLY: list only, no upload zone (design).
          Hotel/transfer/activity render their own docs+notes inside their body. */}
      {kind === 'service' && docs.length > 0 && (
        <Section title={`${t('activity.documents_label')} · ${docs.length}`} accent={accent}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {docs.map((d, i) => (
              <a
                key={`${d.file_url}-${i}`}
                href={d.file_url}
                target="_blank"
                rel="noreferrer"
                className="doc-row"
              >
                <div className="di"><FileText /></div>
                <b>{d.file_name || t('event.file_word')}</b>
                {d.file_size && <span className="ds">{d.file_size}</span>}
              </a>
            ))}
          </div>
        </Section>
      )}

      {/* Notes (hotel/transfer/activity render their own inside their body) */}
      {kind === 'service' && (entity.notes || entity.details?.notes) && (
        <Section title={t('activity.view_notes')} accent={accent}>
          <div className="notes-block" style={{ background: 'transparent', border: 'none', padding: 0 }}>
            {entity.notes || entity.details?.notes}
          </div>
        </Section>
      )}
    </>
  );
}
