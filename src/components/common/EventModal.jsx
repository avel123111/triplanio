/**
 * EventModal - unified, new-design read view for a timeline event
 * (hotel / transfer / activity / car rental). Wraps a shadcn Dialog so it
 * composes cleanly inside ordinary React trees.
 *
 * The per-kind sections, derived display values and document upload now live
 * in the SHARED `EventViewBody` module so the in-place left-panel shell (trip
 * editor) renders the exact same content. EventModal owns only the Dialog
 * chrome (header + meta strip + action buttons + footer).
 *
 * Accepts TWO call shapes so the migration is incremental:
 *
 *   New (preferred):
 *     <EventModal open onOpenChange entity kind visit fromVisit toVisit onEdit readOnly />
 *
 *   Legacy (still used by SourceViewLoader + a few proto screens):
 *     <EventModal event={{ kind, entity, visit, fromVisit, toVisit }}
 *                 canEdit onClose onEdit onDelete />
 *
 * Visual reference: designer prototype `event-view.jsx`.
 */
import React, { useState } from 'react';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Btn } from '@/design/index';
import { normalizeExternalUrl } from '@/lib/booking-platforms';
import { Edit2, Trash2, ExternalLink, Map as MapIcon } from 'lucide-react';
import {
  useEventViewModel, useEntityDocs, EventViewSections,
} from '@/components/common/EventViewBody';

// ─────────────────────────────────────────────────────────────────────────────
//  Main component
// ─────────────────────────────────────────────────────────────────────────────

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
  // Optional conflict banner shown at the very top (Edit Mode → click a conflict).
  const warning = props.warning ?? (legacy ? props.event?.warning : undefined) ?? null;

  // Open/close: new API uses open/onOpenChange; legacy uses onClose.
  // When no `open` is passed (some legacy proto callers conditionally mount
  // the modal), default to true.
  const controlled = typeof props.open !== 'undefined';
  const open = controlled ? !!props.open : true;
  const setOpen = (next) => {
    if (controlled) {
      props.onOpenChange?.(next);
    } else if (!next) {
      props.onClose?.();
    }
  };

  // Inline delete-confirm state - same UX as EventEditDialog so the user
  // sees one consistent confirm flow regardless of where they hit Delete.
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset confirm state when the modal closes so the next open starts fresh.
  React.useEffect(() => {
    if (!open) { setConfirmDel(false); setDeleting(false); }
  }, [open]);

  const vm = useEventViewModel(kind, entity, visit, fromVisit, toVisit);
  const { docs, uploading, uploadFiles } = useEntityDocs(kind, entity, canEdit);

  if (!entity || !kind || !vm) return null;
  const { theme, themeLabel, title, priceText, bookingUrl, platformInfo, platformLogo, mapAddress, metaItems } = vm;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="dlg--wide">
        {/* 4px colour stripe */}
        <div style={{ height: 4, background: theme.color }} />

        {/* Header */}
        <div style={{ padding: '16px 22px 14px', background: theme.soft, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', borderBottom: '1px solid var(--line-2)' }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: theme.color, color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <theme.Icon style={{ width: 20, height: 20 }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--fs-micro)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600, color: 'var(--muted)' }}>{themeLabel}</div>
            <h2 style={{ margin: 0, fontSize: 'var(--fs-h3)', letterSpacing: '-0.02em' }}>{title || themeLabel}</h2>
          </div>
        </div>

        {/* Key meta strip */}
        {(metaItems.length > 0 || priceText || platformInfo) && (
          <div style={{ padding: '10px 22px', display: 'flex', flexWrap: 'wrap', columnGap: 16, rowGap: 6, alignItems: 'center', fontSize: 'var(--fs-meta)', color: 'var(--muted)', borderBottom: '1px solid var(--line-2)', background: 'var(--wash-2)' }}>
            {metaItems.map((m, i) => {
              const Ic = m.icon;
              return (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <Ic style={{ width: 12, height: 12 }} />{m.text}
                </span>
              );
            })}
            {priceText && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600, color: 'var(--ink)' }}>
                {priceText}
              </span>
            )}
            {platformInfo && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 6, fontSize: 'var(--fs-micro)', fontWeight: 600 }}>
                {platformLogo && <img src={platformLogo} alt="" style={{ width: 14, height: 14, borderRadius: 3 }} />}
                {platformInfo.labelKey ? t(platformInfo.labelKey) : platformInfo.label}
              </span>
            )}
          </div>
        )}

        {/* Conflict plate (Edit Mode) - below the date/meta strip */}
        {warning && (
          <div style={{ margin: '12px 22px 0', display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 12px', borderRadius: 10, background: 'var(--warning-soft)', border: '1px solid color-mix(in srgb, var(--warning) 40%, transparent)', color: 'var(--ink)' }}>
            <span style={{ width: 22, height: 22, borderRadius: 6, background: 'color-mix(in srgb, var(--warning) 22%, transparent)', color: 'var(--warning)', display: 'grid', placeItems: 'center', flexShrink: 0, fontSize: 'var(--fs-meta)' }}>⚠️</span>
            <div style={{ fontSize: 'var(--fs-meta)', lineHeight: 1.45, alignSelf: 'center' }}>{warning}</div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ padding: '12px 22px', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {bookingUrl && (
            <Btn
              size="sm"
              onClick={() => window.open(normalizeExternalUrl(bookingUrl), '_blank', 'noopener,noreferrer')}
              style={{ background: theme.color, borderColor: theme.color, color: '#fff' }}
            >
              <ExternalLink style={{ width: 14, height: 14, marginRight: 6 }} />{t('event.view_booking')}
            </Btn>
          )}
          {mapAddress && (
            <Btn
              variant="ghost"
              size="sm"
              onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapAddress)}`, '_blank', 'noopener,noreferrer')}
            >
              <MapIcon style={{ width: 14, height: 14, marginRight: 6 }} />{t('event.show_on_map')}
            </Btn>
          )}
        </div>

        {/* Body - either the inline delete confirm or the normal sections. */}
        {confirmDel ? (
          <div style={{ padding: 22, flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <div style={{ borderRadius: 12, border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', background: 'var(--danger-soft)', padding: 16, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: 'var(--danger-ink)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Trash2 style={{ width: 20, height: 20 }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }}>{t('event.delete_q', { label: themeLabel.toLowerCase() })}</div>
                <div style={{ fontSize: 'var(--fs-meta)', color: 'var(--muted)', marginTop: 4 }}>
                  {t('event.delete_irreversible')}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ padding: '0 22px 22px', flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <EventViewSections
              kind={kind} entity={entity} fromVisit={fromVisit} toVisit={toVisit}
              accent={theme.color} docs={docs} canEdit={canEdit} uploading={uploading} uploadFiles={uploadFiles}
            />
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '12px 22px', display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--line-2)', background: 'var(--wash-2)' }}>
          {confirmDel ? (
            <>
              <div style={{ flex: 1 }} />
              <Btn variant="ghost" size="sm" onClick={() => setConfirmDel(false)} disabled={deleting}>
                {t('trip.form_cancel')}
              </Btn>
              <Btn
                variant="danger-solid"
                size="sm"
                disabled={deleting}
                onClick={async () => {
                  if (!onDelete) return;
                  try {
                    setDeleting(true);
                    await onDelete();
                  } finally {
                    setDeleting(false);
                    setConfirmDel(false);
                  }
                }}
              >
                <Trash2 style={{ width: 14, height: 14, marginRight: 6 }} />{deleting ? t('event.deleting') : t('trip.delete')}
              </Btn>
            </>
          ) : (
            <>
              {canEdit && onDelete && (
                <Btn variant="danger-ghost" size="sm" onClick={() => setConfirmDel(true)}>
                  <Trash2 style={{ width: 14, height: 14, marginRight: 6 }} />{t('trip.delete')}
                </Btn>
              )}
              <div style={{ flex: 1 }} />
              <Btn variant="ghost" size="sm" onClick={() => setOpen(false)}>{t('common.close')}</Btn>
              {canEdit && onEdit && (
                <Btn variant="primary" size="sm" onClick={onEdit} style={{ '--bg': theme.color }}>
                  <Edit2 style={{ width: 14, height: 14, marginRight: 6 }} />{t('trip.edit_trip')}
                </Btn>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
