import React, { useState } from 'react';
import { Icon } from '@/design/icons';
import { useI18n } from '@/lib/i18n/I18nContext';

// trip_services rows carry a `kind` (esim | car_rental | insurance). Mirrors
// base44 TripServicesCard: added services render as booked rows; eSIM/car_rental
// show a dashed placeholder until added; once added, their "add more" moves
// under "Ещё" (where insurance always lives).
const SERVICE_KIND_META = {
  esim:       { icon: 'esim',   labelKey: 'service.kind.esim',       hintKey: 'service.hint.esim' },
  car_rental: { icon: 'car',    labelKey: 'service.kind.car_rental', hintKey: 'service.hint.car_rental' },
  insurance:  { icon: 'shield', labelKey: 'service.kind.insurance',  hintKey: 'service.hint.insurance' },
};

function ServiceRowEmpty({ icon, name, desc, onClick }) {
  return (
    <button onClick={onClick} className="srv-add">
      <span className="srv-ic srv-ic--ph"><Icon name={icon} size={14} /></span>
      <span className="srv-tx">
        <span className="srv-nm">{name}</span>
        <span className="srv-ds">{desc}</span>
      </span>
      <Icon name="plus" size={14} style={{ color: 'var(--brand)', flexShrink: 0 }} />
    </button>
  );
}

// Services widget (Lumo .wdg) — lives on the Overview screen.
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
        <div className="srv-list">
          {services.map((s) => {
            const meta = SERVICE_KIND_META[s.kind];
            return (
              <div key={s.id} className="srv-row">
                <span className="srv-ic"><Icon name={meta?.icon || 'spark'} size={14} /></span>
                <span className="srv-tx">
                  <span className="srv-nm">{meta ? t(meta.labelKey) : s.name}</span>
                  {s.name && <span className="srv-ds">{s.name}</span>}
                </span>
              </div>
            );
          })}

          {topAddKinds.map((k) => (
            <ServiceRowEmpty key={`add-${k}`} icon={SERVICE_KIND_META[k].icon} name={t(SERVICE_KIND_META[k].labelKey)} desc={t(SERVICE_KIND_META[k].hintKey)} onClick={() => onAddService?.(k)} />
          ))}

          {moreOpen ? (
            moreAddKinds.map((k) => (
              <ServiceRowEmpty
                key={`more-${k}`}
                icon={SERVICE_KIND_META[k].icon}
                name={byKind[k].length > 0 ? t('service.add_more', { label: t(SERVICE_KIND_META[k].labelKey) }) : t(SERVICE_KIND_META[k].labelKey)}
                desc={t(SERVICE_KIND_META[k].hintKey)}
                onClick={() => onAddService?.(k)}
              />
            ))
          ) : (
            <button className="srv-more" onClick={() => setMoreOpen(true)}>
              <Icon name="more" size={12} />
              <span>{t('service.more')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
