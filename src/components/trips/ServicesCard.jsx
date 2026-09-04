import React, { useState } from 'react';
import { Icon } from '@/design/icons';
import { AddRow, Btn, Card, CardHeader, ListRow, Skeleton, Tile } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';
import { SERVICE_KINDS } from '@/lib/serviceKinds';

// trip_services rows carry a `kind` (esim | car_rental | insurance). Booked
// services render as the canon <ListRow variant="raised">; not-yet-added ones as
// <ListRow variant="add"> (пунктирный плейсхолдер той же формы/высоты — TRIP-337).
// Colours come from the shared SERVICE_KINDS source so the widget matches the
// service view/edit dialogs (each kind its own colour).
const SERVICE_KIND_META = SERVICE_KINDS;

/**
 * @param {{ services?: any[], isLoading?: boolean,
 *           onAddService?: any, onOpenService?: any }} p
 */
export default function ServicesCard({ services = [], isLoading = false, onAddService, onOpenService }) {
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
    <Card className="col col--g6">
      <CardHeader title={t('trip.sidebar_services')} />
      <div>
        <div className="col col--g4">
          {/* ★ ФАЗА ЗАГРУЗКИ — ТЕ ЖЕ ряды `AddRow` и та же кнопка «Ещё», только
              с заглушками: иначе одна карточка из трёх показывает готовый вид,
              пока соседние ещё грузятся. */}
          {isLoading ? (
            <>
              {[0, 1].map((i) => (
                <AddRow key={i} icon="dot" title={<Skeleton w={96} h={18} r={5} />} sub={<Skeleton w={128} h={18} r={5} />} />
              ))}
              <Btn variant="soft" block disabled><Skeleton w={72} h={17} r={5} /></Btn>
            </>
          ) : (
          <>
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
            <AddRow key={`add-${k}`} icon={SERVICE_KIND_META[k].icon} accent={SERVICE_KIND_META[k].color} title={t(SERVICE_KIND_META[k].labelKey)} sub={t(SERVICE_KIND_META[k].hintKey)} onClick={() => onAddService?.(k)} />
          ))}

          {/* "Ещё" — insurance + add-more for kinds already present */}
          {moreOpen ? (
            moreAddKinds.map((k) => (
              <AddRow
                key={`more-${k}`}
                icon={SERVICE_KIND_META[k].icon}
                accent={SERVICE_KIND_META[k].color}
                title={byKind[k].length > 0 ? t('service.add_more', { label: t(SERVICE_KIND_META[k].labelKey) }) : t(SERVICE_KIND_META[k].labelKey)}
                sub={t(SERVICE_KIND_META[k].hintKey)}
                onClick={() => onAddService?.(k)}
              />
            ))
          ) : (
            <Btn variant="soft" block onClick={() => setMoreOpen(true)}>
              <Icon name="plus" size={15} />{t('service.more')}
            </Btn>
          )}
          </>
          )}
        </div>
      </div>
    </Card>
  );
}
