import React, { useState } from 'react';
import { Icon } from '@/design/icons';
import { useI18n } from '@/lib/i18n/I18nContext';

// trip_services rows carry a `kind` (esim | car_rental | insurance). Booked
// services render as Lumo .bookrow; not-yet-added ones as the dashed .gadd
// (ghost-add) row — both are design-system components, no bespoke styling.
const SERVICE_KIND_META = {
  esim:       { icon: 'esim',   labelKey: 'service.kind.esim',       hintKey: 'service.hint.esim' },
  car_rental: { icon: 'car',    labelKey: 'service.kind.car_rental', hintKey: 'service.hint.car_rental' },
  insurance:  { icon: 'shield', labelKey: 'service.kind.insurance',  hintKey: 'service.hint.insurance' },
};

// Dashed "add service" row — Lumo .gadd. `--a` sets the hover accent.
function AddRow({ icon, label, hint, onClick }) {
  return (
    <button className="gadd" style={{ '--a': 'var(--brand)' }} onClick={onClick}>
      <span className="gi"><Icon name={icon} size={17} /></span>
      <span className="gt"><b>{label}</b><span>{hint}</span></span>
      <Icon name="plus" size={15} style={{ color: 'var(--brand)', flexShrink: 0 }} />
    </button>
  );
}

export default function ServicesCard({ services = [], onAddService }) {
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
        <span className="wi wi--primary"><Icon name="spark" size={17} /></span>
        <h4>{t('trip.sidebar_services')}</h4>
      </div>
      <div className="wdg-b">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Booked services — Lumo .bookrow */}
          {services.map((s) => {
            const meta = SERVICE_KIND_META[s.kind];
            return (
              <div key={s.id} className="bookrow" style={{ cursor: 'default' }}>
                <span className="bi" style={{ background: 'var(--primary-soft)', color: 'var(--brand)' }}>
                  <Icon name={meta?.icon || 'spark'} size={18} />
                </span>
                <div className="bt">
                  <b>{meta ? t(meta.labelKey) : s.name}</b>
                  {s.name && <span>{s.name}</span>}
                </div>
              </div>
            );
          })}

          {/* Not-yet-added eSIM / car rental — dashed .gadd */}
          {topAddKinds.map((k) => (
            <AddRow key={`add-${k}`} icon={SERVICE_KIND_META[k].icon} label={t(SERVICE_KIND_META[k].labelKey)} hint={t(SERVICE_KIND_META[k].hintKey)} onClick={() => onAddService?.(k)} />
          ))}

          {/* "Ещё" — insurance + add-more for kinds already present */}
          {moreOpen ? (
            moreAddKinds.map((k) => (
              <AddRow
                key={`more-${k}`}
                icon={SERVICE_KIND_META[k].icon}
                label={byKind[k].length > 0 ? t('service.add_more', { label: t(SERVICE_KIND_META[k].labelKey) }) : t(SERVICE_KIND_META[k].labelKey)}
                hint={t(SERVICE_KIND_META[k].hintKey)}
                onClick={() => onAddService?.(k)}
              />
            ))
          ) : (
            <button className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMoreOpen(true)}>
              <Icon name="more" size={14} />{t('service.more')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
