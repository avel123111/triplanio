import React, { useState } from 'react';
import { Icon } from '@/design/icons';
import { Btn, ListRow, Tile } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';
import { SERVICE_KINDS } from '@/lib/serviceKinds';

// trip_services rows carry a `kind` (esim | car_rental | insurance). Booked
// services render as the canon <ListRow variant="raised">; not-yet-added ones as
// <ListRow variant="add"> (пунктирный плейсхолдер той же формы/высоты — TRIP-337).
// Colours come from the shared SERVICE_KINDS source so the widget matches the
// service view/edit dialogs (each kind its own colour).
const SERVICE_KIND_META = SERVICE_KINDS;

// Ряд «добавить сервис» — тихая компактная строка, ТОЙ ЖЕ формы, что и
// незабронированное в «Подготовке»: одно и то же по смыслу («этого ещё нет»)
// обязано выглядеть одинаково на всём экране. Прежний пунктирный бокс совпадал
// по высоте с карточкой наличия — и ровно поэтому «есть» и «нет» не отличались.
// `--a` объявляет акцент ховера по виду сервиса (рамка/подпись/плюс уезжают в тон).
function AddRow({ icon, label, hint, color, onClick }) {
  return (
    <ListRow
      variant="compact"
      lead={<Tile tone="quiet" size="sm" icon={icon} />}
      title={label}
      sub={hint}
      trail={<Icon name="plus" size={16} />}
      onClick={onClick}
      style={{ '--a': color }}
    />
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
    <section className="ovsec">
      <div className="ovsec__h">
        <h3 className="t-heading">{t('trip.sidebar_services')}</h3>
      </div>
      <div>
        <div className="col col--g4">
          {/* Booked services — канон <ListRow variant="raised"> */}
          {services.map((s) => {
            const meta = SERVICE_KIND_META[s.kind];
            return (
              <ListRow
                key={s.id}
                variant="raised"
                lead={<Tile icon={meta?.icon || 'ticket'} style={{ '--hl-soft': meta?.soft || 'var(--brand-soft)', '--hl-ink': meta?.color || 'var(--brand)' }} />}
                title={meta ? t(meta.labelKey) : s.name}
                sub={s.name || undefined}
                trail={<Icon name="chev" size={16} className="chev" />}
                onClick={() => onOpenService?.(s)}
              />
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
    </section>
  );
}
