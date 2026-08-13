import React, { useState } from 'react';
import { Icon } from '@/design/icons';
import { Btn, Card } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';
import { SERVICE_KINDS } from '@/lib/serviceKinds';

// trip_services rows carry a `kind` (esim | car_rental | insurance). Booked
// services render as Lumo .bookrow; not-yet-added ones as the dashed
// placeholder (`Btn variant="dashed" tile`). Colours come from the shared SERVICE_KINDS source so the
// widget matches the service view/edit dialogs (each kind its own colour).
const SERVICE_KIND_META = SERVICE_KINDS;

// Пунктирный ряд «добавить сервис» — та же форма примитива, что у панели города
// (`Btn variant="dashed"` с плиткой). `--a` объявляет акцент ховера по виду
// сервиса. Плюс справа больше не красится СВОИМ цветом постоянно: он берёт
// `--fg` кнопки, то есть в покое серый, а на наведении уезжает в акцент вместе
// с рамкой и плиткой — один язык на весь плейсхолдер.
function AddRow({ icon, label, hint, color, onClick }) {
  return (
    <Btn variant="dashed" block tile icon={icon} sub={hint} iconRight="plus" style={{ '--a': color }} onClick={onClick}>
      {label}
    </Btn>
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
    <Card radius="lg" pad="none" className="ov-wdg">
      <div className="wdg-h">
        <span className="wi"><Icon name="folder-bookmark" size={17} /></span>
        <h4>{t('trip.sidebar_services')}</h4>
      </div>
      <div className="wdg-b">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Booked services — Lumo .bookrow */}
          {services.map((s) => {
            const meta = SERVICE_KIND_META[s.kind];
            // TRIP-391 объект 1 → объект 6: .bookrow — clickable РЯД сервиса (.row), не кнопка-примитив.
            return (
              <button key={s.id} className="row bookrow" onClick={() => onOpenService?.(s)}>
                <span className="bi" style={{ background: meta?.soft || 'var(--brand-soft)', color: meta?.color || 'var(--brand)' }}>
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

          {/* Not-yet-added eSIM / car rental — the dashed placeholder */}
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
            <Btn variant="soft" block onClick={() => setMoreOpen(true)}>
              <Icon name="plus" size={15} />{t('service.more')}
            </Btn>
          )}
        </div>
      </div>
    </Card>
  );
}
