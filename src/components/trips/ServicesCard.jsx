import React, { useState } from 'react';
import { Icon } from '@/design/icons';
import { useI18n } from '@/lib/i18n/I18nContext';
import { SERVICE_KINDS } from '@/lib/serviceKinds';

// trip_services rows carry a `kind` (esim | car_rental | insurance). Booked
// services render as Lumo .bookrow; not-yet-added ones as the dashed .gadd
// (ghost-add) row. Colours come from the shared SERVICE_KINDS source so the
// widget matches the service view/edit dialogs (each kind its own colour).
const SERVICE_KIND_META = SERVICE_KINDS;

// Dashed "add service" row — Lumo .gadd. `--a` sets the per-service hover accent.
function AddRow({ icon, label, hint, color, onClick }) {
  return (
    <button className="gadd" style={{ '--a': color }} onClick={onClick}>
      <span className="gi"><Icon name={icon} size={17} /></span>
      <span className="gt"><b>{label}</b><span>{hint}</span></span>
      <Icon name="plus" size={15} style={{ color, flexShrink: 0 }} />
    </button>
  );
}

export default function ServicesCard({ services = [], onAddService, onOpenService }) {
  const { t } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);

  const byKind = { esim: [], car_rental: [], insurance: [] };
  for (const s of services) { if (byKind[s.kind]) byKind[s.kind].push(s); }

  const topAddKinds = ['esim', 'car_rental'].filter(k => byKind[k].length === 0);
  const moreAddKinds = [];
  if (byKind.esim.length > 0) moreAddKinds.push('esim');
  if (byKind.car_rental.length > 0) moreAddKinds.push('car_rental');
  moreAddKinds.push('insurance');

  return (
    <div className="wdg ov-wdg">
      <div className="wdg-h">
        <span className="wi wi--primary"><Icon name="folder-bookmark" size={17} /></span>
        <h4>{t('trip.sidebar_services')}</h4>
      </div>
      <div className="wdg-b">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Booked services — Lumo .bookrow */}
          {services.map((s) => {
            const meta = SERVICE_KIND_META[s.kind];
            return (
              <button key={s.id} className="bookrow" onClick={() => onOpenService?.(s)}>
                <span className="bi" style={{ background: meta?.soft || 'var(--primary-soft)', color: meta?.color || 'var(--brand)' }}>
                  <Icon name={meta?.icon || 'ticket'} size={18} />
                </span>
                <div className="bt">
                  <b>{meta ? t(meta.labelKey) : s.name}</b>
                  {s.name && <span>{s.name}</span>}
                </div>
                <Icon name="chev" size={16} className="chev" style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
              </button>
            );
          })}

          {/* Not-yet-added eSIM / car rental — dashed .gadd */}
          {topAddKinds.map((k) => (
            <AddRow key={`add-${k}`} icon={SERVICE_KIND_META[k].icon} color={SERVICE_KIND_META[k].color} label={t(SERVICE_KIND_META[k].labelKey)} hint={t(SERVICE_KIND_META[k].hintKey)} onClick={() => onAddService?.(k)} />
          ))}

          {/* "Ещё" — insurance + add-more for kinds already present */}
          {moreOpen ? (
            moreAddKinds.map((k) => (
              <AddRow
                key={`more-${k}`}
                icon={SERVICE_KIND_META[k].icon}
                color={SERVICE_KIND_META[k].color}
                label={byKind[k].length > 0 ? t('service.add_more', { label: t(SERVICE_KIND_META[k].labelKey) }) : t(SERVICE_KIND_META[k].labelKey)}
                hint={t(SERVICE_KIND_META[k].hintKey)}
                onClick={() => onAddService?.(k)}
              />
            ))
          ) : (
            <button className="btn btn--soft btn--block" onClick={() => setMoreOpen(true)}>
              <Icon name="plus" size={15} />{t('service.more')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
