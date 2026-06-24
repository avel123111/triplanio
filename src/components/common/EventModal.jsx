/**
 * EventModal - unified, new-design (Lumo .ev-dlg) read view for a timeline
 * event (hotel / transfer / activity / car rental / esim / insurance).
 *
 * The per-kind sections, derived display values and document upload live in the
 * SHARED `EventViewBody` module so the in-place left-panel shell renders the
 * same content. EventModal owns the dialog chrome (header + body + footer).
 *
 * Accepts TWO call shapes:
 *   New:    <EventModal open onOpenChange entity kind visit fromVisit toVisit onEdit readOnly />
 *   Legacy: <EventModal event={{ kind, entity, visit, fromVisit, toVisit }} canEdit onClose onEdit onDelete />
 *
 * Visual reference: Lumo design system event dialog (EVENTS_SERVICES_REDESIGN).
 */
import React, { useState } from 'react';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Btn } from '@/design/index';
import { normalizeExternalUrl } from '@/lib/booking-platforms';
import {
  Edit2, Trash2, ExternalLink, MapPin, X,
} from 'lucide-react';
import {
  useEventViewModel, useEntityDocs, EventViewSections,
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
  const { t } = useI18n();

  // Adapt the two call shapes into a single internal shape.
  const legacy = !!props.event;
  const kind = legacy ? props.event.kind : props.kind;
  const entity = legacy ? props.event.entity : props.entity;
  const visit = legacy ? props.event.visit : props.visit;
  const fromVisit = legacy ? props.event.fromVisit : props.fromVisit;
  const toVisit = legacy ? props.event.toVisit : props.toVisit;
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

  const vm = useEventViewModel(kind, entity, visit, fromVisit, toVisit);
  const { docs, uploading, uploadFiles } = useEntityDocs(kind, entity, canEdit);

  if (!entity || !kind || !vm) return null;
  const { theme, themeLabel, title, priceText, bookingUrl, mapAddress, platformInfo, platformLogo } = vm;
  const eyebrow = getEyebrowText(kind, entity, t, visit, fromVisit, toVisit, themeLabel);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className={`${kind === 'service' ? 'dlg--sm' : 'dlg--wide'} ev-dlg`}
        style={{
          '--ev-color': theme.color,
          '--ev-soft': theme.soft,
          '--ev-ink': theme.ink || theme.color,
          padding: 0,
        }}
      >
        {/* Header */}
        <div className="ev-dlg-hd">
          <div className="ev-dlg-ic"><theme.Icon /></div>
          <div className="ev-dlg-info">
            <div className="ev-dlg-eyebrow">{eyebrow}</div>
            <h2>{title || themeLabel}</h2>
          </div>
          {priceText && (
            <div className="ev-dlg-price">
              <div className="amt">{priceText}</div>
              {entity.currency && <div className="cur">{entity.currency}</div>}
            </div>
          )}
          <button className="ev-dlg-close" onClick={() => setOpen(false)} aria-label={t('common.close')}>
            <X />
          </button>
        </div>

        {/* Body */}
        <div className="ev-dlg-body">
          {warning && (
            <div className="warn-banner">
              <span>⚠️</span>
              <div>{warning}</div>
            </div>
          )}

          {confirmDel ? (
            <div className="del-confirm">
              <div className="del-confirm-ic"><Trash2 style={{ width: 20, height: 20 }} /></div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)' }}>{t('event.delete_q', { label: themeLabel.toLowerCase() })}</div>
                <div style={{ fontSize: 'var(--fs-meta)', color: 'var(--muted)', marginTop: 4 }}>{t('event.delete_irreversible')}</div>
              </div>
            </div>
          ) : (
            <>
              {(bookingUrl || mapAddress) && (
                <div className="ev-actions-top">
                  {bookingUrl && (
                    <a
                      href={normalizeExternalUrl(bookingUrl)}
                      target="_blank"
                      rel="noreferrer"
                      className="bk-link"
                    >
                      {platformLogo ? (
                        <span className="pb" style={{ background: platformInfo?.color || 'var(--surface-2)', overflow: 'hidden' }}>
                          <img src={platformLogo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </span>
                      ) : platformInfo ? (
                        <span className="pb" style={{ background: platformInfo.color || 'var(--muted)' }}>
                          {(platformInfo.labelKey ? t(platformInfo.labelKey) : platformInfo.label || '?').charAt(0)}
                        </span>
                      ) : null}
                      {t('event.view_booking')}
                      <ExternalLink />
                    </a>
                  )}
                  {mapAddress && (
                    <button
                      type="button"
                      className="bk-link"
                      onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapAddress)}`, '_blank', 'noopener,noreferrer')}
                    >
                      <MapPin />
                      {t('service.car_view_on_map')}
                    </button>
                  )}
                </div>
              )}
              <EventViewSections
                kind={kind} entity={entity} fromVisit={fromVisit} toVisit={toVisit}
                accent={theme.color} docs={docs} canEdit={canEdit} uploading={uploading} uploadFiles={uploadFiles}
              />
            </>
          )}
        </div>

        {/* Footer — only when there are edit/delete actions (map + booking moved
            to the top action row, so read-only events no longer need a footer). */}
        {canEdit && (onDelete || onEdit) && (
        <div className="ev-dlg-ft">
          {confirmDel ? (
            <>
              <Btn variant="ghost" size="sm" onClick={() => setConfirmDel(false)} disabled={deleting}>
                {t('trip.form_cancel')}
              </Btn>
              <Btn
                variant="danger-solid"
                size="sm"
                disabled={deleting}
                onClick={async () => {
                  if (!onDelete) return;
                  try { setDeleting(true); await onDelete(); }
                  finally { setDeleting(false); setConfirmDel(false); }
                }}
              >
                <Trash2 style={{ width: 14, height: 14, marginRight: 6 }} />{deleting ? t('event.deleting') : t('trip.delete')}
              </Btn>
            </>
          ) : (
            <>
              {canEdit && onDelete && (
                <Btn variant="danger" size="sm" onClick={() => setConfirmDel(true)}>
                  <Trash2 style={{ width: 14, height: 14, marginRight: 6 }} />{t('trip.delete')}
                </Btn>
              )}
              {canEdit && onEdit && (
                <Btn variant="primary" size="sm" onClick={onEdit} style={{ '--bg': theme.color }}>
                  <Edit2 style={{ width: 14, height: 14, marginRight: 6 }} />{t('trip.edit_trip')}
                </Btn>
              )}
            </>
          )}
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
