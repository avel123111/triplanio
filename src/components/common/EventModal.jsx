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
import { Button } from '@/components/ui/button';
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
      <DialogContent className="p-0 max-w-xl max-h-[90vh] overflow-y-auto overflow-x-hidden gap-0 w-[calc(100%-1rem)] sm:w-full" style={{ background: 'var(--surface)' }}>
        {/* 4px colour stripe */}
        <div style={{ height: 4, background: theme.color }} />

        {/* Header */}
        <div
          className="border-b"
          style={{ padding: '16px 22px 14px', background: theme.soft, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}
        >
          <div
            style={{
              width: 40, height: 40, borderRadius: 10,
              background: theme.color, color: 'white',
              display: 'grid', placeItems: 'center', flexShrink: 0,
            }}
          >
            <theme.Icon className="w-5 h-5" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{themeLabel}</div>
            <h2 className="font-display text-xl leading-tight" style={{ letterSpacing: '-0.02em' }}>{title || themeLabel}</h2>
          </div>
        </div>

        {/* Key meta strip */}
        {(metaItems.length > 0 || priceText || platformInfo) && (
          <div
            className="border-b bg-secondary/30 text-xs text-muted-foreground"
            style={{ padding: '10px 22px', display: 'flex', flexWrap: 'wrap', columnGap: 16, rowGap: 6, alignItems: 'center' }}
          >
            {metaItems.map((m, i) => {
              const Ic = m.icon;
              return (
                <span key={i} className="inline-flex items-center gap-1.5">
                  <Ic className="w-3 h-3" />{m.text}
                </span>
              );
            })}
            {priceText && (
              <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                {priceText}
              </span>
            )}
            {platformInfo && (
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium ${platformInfo.color}`}>
                {platformLogo && <img src={platformLogo} alt="" className="w-3.5 h-3.5 rounded-sm" />}
                {platformInfo.labelKey ? t(platformInfo.labelKey) : platformInfo.label}
              </span>
            )}
          </div>
        )}

        {/* Conflict plate (Edit Mode) - below the date/meta strip */}
        {warning && (
          <div style={{ margin: '12px 22px 0', display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 12px', borderRadius: 10, background: 'var(--warning-soft)', border: '1px solid color-mix(in srgb, var(--warning) 40%, transparent)', color: 'var(--ink)' }}>
            <span style={{ width: 22, height: 22, borderRadius: 6, background: 'color-mix(in srgb, var(--warning) 22%, transparent)', color: 'var(--warning)', display: 'grid', placeItems: 'center', flexShrink: 0, fontSize: 12 }}>⚠️</span>
            <div style={{ fontSize: 12.5, lineHeight: 1.45, alignSelf: 'center' }}>{warning}</div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ padding: '12px 22px', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {bookingUrl && (
            <Button
              size="sm"
              onClick={() => window.open(normalizeExternalUrl(bookingUrl), '_blank', 'noopener,noreferrer')}
              style={{ background: theme.color, borderColor: theme.color }}
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />{t('event.view_booking')}
            </Button>
          )}
          {mapAddress && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapAddress)}`, '_blank', 'noopener,noreferrer')}
            >
              <MapIcon className="w-3.5 h-3.5 mr-1.5" />{t('event.show_on_map')}
            </Button>
          )}
        </div>

        {/* Body - either the inline delete confirm or the normal sections. */}
        {confirmDel ? (
          <div style={{ padding: 22 }}>
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-destructive/15 text-destructive grid place-items-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-display font-semibold text-base">{t('event.delete_q', { label: themeLabel.toLowerCase() })}</div>
                <div className="text-sm text-muted-foreground mt-1">
                  {t('event.delete_irreversible')}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ padding: '0 22px 22px' }}>
            <EventViewSections
              kind={kind} entity={entity} fromVisit={fromVisit} toVisit={toVisit}
              accent={theme.color} docs={docs} canEdit={canEdit} uploading={uploading} uploadFiles={uploadFiles}
            />
          </div>
        )}

        {/* Footer */}
        <div
          className="border-t bg-secondary/30"
          style={{ padding: '12px 22px', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          {confirmDel ? (
            <>
              <div style={{ flex: 1 }} />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDel(false)}
                disabled={deleting}
              >
                {t('trip.form_cancel')}
              </Button>
              <Button
                size="sm"
                disabled={deleting}
                onClick={async () => {
                  if (!onDelete) return;
                  try {
                    setDeleting(true);
                    await onDelete();
                  } finally {
                    // Parent should close the modal; if it doesn't (error),
                    // restore the view so the user isn't stuck on the confirm.
                    setDeleting(false);
                    setConfirmDel(false);
                  }
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />{deleting ? t('event.deleting') : t('trip.delete')}
              </Button>
            </>
          ) : (
            <>
              {canEdit && onDelete && (
                <Button variant="ghost" size="sm" onClick={() => setConfirmDel(true)} className="text-destructive hover:text-destructive">
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />{t('trip.delete')}
                </Button>
              )}
              <div style={{ flex: 1 }} />
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>{t('common.close')}</Button>
              {canEdit && onEdit && (
                <Button
                  size="sm"
                  onClick={onEdit}
                  style={{ background: theme.color, borderColor: theme.color }}
                >
                  <Edit2 className="w-3.5 h-3.5 mr-1.5" />{t('trip.edit_trip')}
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
