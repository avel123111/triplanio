// @ts-check
/**
 * EventModal - unified read view for a timeline event (hotel / transfer /
 * activity / car rental / esim / insurance).
 *
 * The per-kind sections, derived display values and document upload live in the
 * SHARED `EventViewBody` module so the in-place left-panel shell renders the
 * same content. TRIP-333 §4: the chrome around it is shared too - header, body
 * and footer are the `.lp-*` canon, the same one `PanelShell` renders; this
 * module owns only the CONTAINER (a Radix dialog instead of an inline panel).
 * `.ev-dlg` тут больше нет: единственное, что этот класс делает, - скоупит цвет
 * подписи поля (`.ev-dlg .field__label`), а в ПРОСМОТРЕ полей нет ни одного.
 * Он остался только на редакторе, где действительно несёт эту роль.
 *
 * Accepts TWO call shapes:
 *   New:    <EventModal open onOpenChange entity kind visit fromVisit toVisit onEdit readOnly />
 *   Legacy: <EventModal event={{ kind, entity, visit, fromVisit, toVisit }} canEdit onClose onEdit onDelete />
 *
 * Visual reference: Lumo design system event shell (EVENTS_SERVICES_REDESIGN).
 */
import React, { useState } from 'react';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Btn, IconBtn, Severity, Tile, DialogRoot as Dialog, DialogContent, DialogTitle } from '@/design/index';
import {
  useEventViewModel, useEntityDocs, EventViewSections, eventHeader,
} from '@/components/common/EventViewBody';

// ── Eyebrow (category line) per kind — текст без инлайн-иконки ────────────────
function getEyebrowText(kind, entity, t, visit, fromVisit, toVisit, themeLabel) {
  if (kind === 'hotel') {
    return `${t('budget.cat_accommodation')}${visit?.city_name ? ' · ' + visit.city_name : ''}`;
  }
  if (kind === 'transfer') {
    const route = (fromVisit?.city_name && toVisit?.city_name)
      ? ' · ' + fromVisit.city_name + ' → ' + toVisit.city_name : '';
    return `${themeLabel}${route}`;
  }
  if (kind === 'activity') {
    return `${t('budget.source_activity')}${visit?.city_name ? ' · ' + visit.city_name : ''}`;
  }
  if (kind === 'service') {
    if (entity?.kind === 'esim') return t('service.esim_eyebrow');
    if (entity?.kind === 'insurance') return t('service.insurance_eyebrow');
    return t('service.car_kind_label');
  }
  return themeLabel;
}

export default function EventModal(props) {
  const { t, lang } = useI18n();

  // Adapt the two call shapes into a single internal shape.
  const legacy = !!props.event;
  const kind = legacy ? props.event.kind : props.kind;
  const entity = legacy ? props.event.entity : props.entity;
  const visit = legacy ? props.event.visit : props.visit;
  const fromVisit = legacy ? props.event.fromVisit : props.fromVisit;
  const toVisit = legacy ? props.event.toVisit : props.toVisit;
  // Which timeline point opened this entity (car pickup vs car return) — see
  // useEventViewModel. Null for entities with a single point.
  const subEvent = (legacy ? props.event.subEvent : props.subEvent) ?? null;
  const canEdit = legacy ? !!props.canEdit : !props.readOnly;
  const onEdit = props.onEdit;
  const onDelete = legacy ? props.onDelete : undefined;
  const warning = props.warning ?? (legacy ? props.event?.warning : undefined) ?? null;

  const controlled = typeof props.open !== 'undefined';
  const open = controlled ? !!props.open : true;
  const setOpen = (next) => {
    if (controlled) props.onOpenChange?.(next);
    else if (!next) props.onClose?.();
  };

  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  React.useEffect(() => {
    if (!open) { setConfirmDel(false); setDeleting(false); }
  }, [open]);

  const vm = useEventViewModel(kind, entity, visit, fromVisit, toVisit, subEvent);
  const { docs, uploading, uploadFiles } = useEntityDocs(kind, entity, canEdit);

  if (!entity || !kind || !vm) return null;
  const { theme, themeLabel, title, priceText } = vm;
  // Шапка - ОБЩИЙ шов, тот же, что у создания и у редактирования.
  const hdr = eventHeader({ kind, visit, fromVisit, toVisit, entity, t, lang });
  const eyebrow = kind === 'service' ? getEyebrowText(kind, entity, t, visit, fromVisit, toVisit, themeLabel) : hdr.eyebrow;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className={kind === 'service' ? 'dlg--sm' : 'dlg--wide'}
        aria-describedby={undefined}
        style={{
          '--hl': theme.color,
          '--hl-soft': theme.soft,
          '--hl-ink': theme.ink || theme.color,
          padding: 0,
        }}
      >
        {/* Header — ОБЩАЯ шапка события (TRIP-333 §4). Тот же набор, что у
            панели просмотра и панели добавления: плитка типа, эйбрау, заголовок
            и вторичная строка моноширинным. Своей у диалога больше нет.
            Содержимое второй строки у оболочек РАЗНОЕ и таким остаётся: панель
            просмотра ставит туда даты проживания, диалог - цену. */}
        <div className="lp-h lp-h--ev">
          <Tile as="span" className="lp-ic"><theme.Icon /></Tile>
          <div className="lp-ti">
            <div className="eyebrow">{eyebrow}</div>
            <div className="lp-tirow">
              <DialogTitle asChild><b className="t-title">{(kind === 'service' ? title : hdr.title) || themeLabel}</b></DialogTitle>
              {kind === 'service'
                ? (priceText && <span className="t-mono">{priceText}{entity.currency ? ` ${entity.currency}` : ''}</span>)
                : (hdr.sub && <span className="t-meta">{hdr.sub}</span>)}
            </div>
          </div>
          <IconBtn icon="close" onClick={() => setOpen(false)} ariaLabel={t('common.close')} />
        </div>

        {/* Body */}
        <div className="lp-b scrollbar-thin">
          {confirmDel ? (
            <Severity level="error" icon="trash" title={t('event.delete_q', { label: themeLabel.toLowerCase() })}>
              <div className="t-meta">{t('event.delete_irreversible')}</div>
            </Severity>
          ) : (
            <EventViewSections
              kind={kind} entity={entity} visit={visit} fromVisit={fromVisit} toVisit={toVisit}
              accent={theme.color} docs={docs} canEdit={canEdit} uploading={uploading} uploadFiles={uploadFiles}
              externalWarning={warning} subEvent={subEvent}
            />
          )}
        </div>

        {/* Footer — only when there are edit/delete actions (map + booking moved
            to the top action row, so read-only events no longer need a footer). */}
        {canEdit && (onDelete || onEdit) && (
        /* Единый канон-футер event/service view — тот же набор и те же i18n-ключи,
           что у панели просмотра (EventSourcePanel): удалить (danger) + primary,
           стандартный `.lp-f` (кнопки справа, натуральной ширины). Корзина
           рисуется `icon`-пропом, не сырым lucide. */
        <div className="lp-f">
          {confirmDel ? (
            <>
              <Btn variant="secondary" onClick={() => setConfirmDel(false)} disabled={deleting}>{t('common.cancel')}</Btn>
              <Btn
                variant="danger-solid"
                icon="trash"
                loading={deleting}
                disabled={deleting}
                onClick={async () => {
                  if (!onDelete) return;
                  try { setDeleting(true); await onDelete(); }
                  finally { setDeleting(false); setConfirmDel(false); }
                }}
              >
                {t('common.delete')}
              </Btn>
            </>
          ) : (
            <>
              {onDelete && (
                <Btn variant="danger" icon="trash" onClick={() => setConfirmDel(true)} ariaLabel={t('common.delete')}>
                  {t('common.delete')}
                </Btn>
              )}
              {onEdit && (
                <Btn variant="primary" icon="edit" onClick={onEdit}>{t('trip.edit_trip')}</Btn>
              )}
            </>
          )}
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
