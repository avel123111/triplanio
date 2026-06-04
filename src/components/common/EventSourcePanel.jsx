/**
 * EventSourcePanel - in-place LEFT-PANEL counterpart of SourceViewLoader.
 *
 * Same orchestration (load by id -> view / edit / delete) but rendered inline
 * in the trip-editor's left column instead of a modal:
 *   - view   -> PanelShell + EventViewSections (shared with EventModal, Ф0)
 *   - edit   -> EventEditDialog variant="panel" (shared body, Ф1)
 *   - delete -> inline confirm -> delete row -> invalidate -> onClose()
 *
 * Reuses useEntitySource / useEventViewModel / useEntityDocs / EventViewSections
 * so there is no duplicated fetch or render logic between the modal and panel.
 */
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY } from '@/lib/trip-data';
import { useT } from '@/lib/i18n/I18nContext';
import { Icon } from '@/design/icons';
import { Btn, Skeleton } from '@/design/index';
import EventEditDialog from '@/components/common/EventEditDialog';
import {
  useEntitySource, useEventViewModel, useEntityDocs, EventViewSections,
} from '@/components/common/EventViewBody';

const TABLE_BY_KIND = { hotel: 'hotel_stays', transfer: 'transfers', activity: 'activities', service: 'trip_services' };

// Shared left-panel chrome (back-button + accent stripe + icon + title/sub +
// scrollable body + sticky footer). Inline styles to match TripStructureEdit.
export function PanelShell({ accent, iconName, title, sub, onBack, foot, children }) {
  const t = useT();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--surface)' }}>
      <div style={{ position: 'relative', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 11, padding: '16px 18px 14px 20px', borderBottom: '1px solid var(--line-2)' }}>
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: accent || 'var(--brand)' }} />
        <button onClick={onBack} title={t('common.back')} style={{ width: 32, height: 32, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink-2)', cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="back" size={16} />
        </button>
        <span style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', flexShrink: 0, background: 'color-mix(in srgb, ' + (accent || 'var(--brand)') + ' 14%, transparent)', color: accent || 'var(--brand)' }}>
          <Icon name={iconName || 'pin'} size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
          {sub && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
        </div>
      </div>
      <div className="scrollbar-thin" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 18px 24px' }}>{children}</div>
      {foot && <div style={{ flexShrink: 0, padding: '12px 18px', borderTop: '1px solid var(--line-2)', background: 'var(--wash-2)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>{foot}</div>}
    </div>
  );
}

// Icon name per kind for the panel header (design/icons names).
const KIND_ICON = { hotel: 'bed', transfer: 'plane', activity: 'spark', service: 'car' };

export default function EventSourcePanel({ kind, id, canEdit = false, warning = null, onClose }) {
  const t = useT();
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  React.useEffect(() => { setEditMode(false); setConfirmDel(false); }, [kind, id]);

  const { data, visit, fromVisit, toVisit } = useEntitySource(kind, id, { open: true, onError: () => onClose?.() });
  const vm = useEventViewModel(kind, data, visit, fromVisit, toVisit);
  const { docs, uploading, uploadFiles } = useEntityDocs(kind, data, canEdit);

  const invalidate = () => {
    const tripId = data?.trip_id;
    if (tripId) {
      qc.invalidateQueries({ queryKey: TRIP_CONTENT_KEY(tripId) });
      qc.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
    }
  };

  // Loading state - keep the column from going blank while the row loads.
  if (!data || !vm) {
    return (
      <div style={{ padding: 20 }}>
        <Skeleton w="55%" h={22} style={{ marginBottom: 14 }} />
        <Skeleton w="100%" h={90} style={{ marginBottom: 10 }} />
        <Skeleton w="100%" h={120} />
      </div>
    );
  }

  // EDIT - the shared edit body rendered inline (no overlay).
  if (editMode) {
    return (
      <EventEditDialog
        open
        variant="panel"
        kind={kind}
        tripId={data.trip_id}
        entity={data}
        visit={visit}
        fromVisit={fromVisit}
        toVisit={toVisit}
        onOpenChange={(o) => { if (!o) { setEditMode(false); invalidate(); } }}
      />
    );
  }

  const accent = vm.theme.color;
  const doDelete = async () => {
    const table = TABLE_BY_KIND[kind];
    if (!table) return;
    setDeleting(true);
    const { error } = await supabase.from(table).delete().eq('id', data.id);
    setDeleting(false);
    if (error) { alert(t('event.delete_failed') + ': ' + error.message); return; }
    invalidate();
    onClose?.();
  };

  return (
    <PanelShell
      accent={accent}
      iconName={KIND_ICON[kind] || 'pin'}
      title={vm.title || vm.themeLabel}
      sub={vm.themeLabel}
      onBack={onClose}
      foot={confirmDel ? (
        <>
          <Btn variant="ghost" onClick={() => setConfirmDel(false)} disabled={deleting}>{t('common.cancel')}</Btn>
          <Btn variant="danger-solid" icon="trash" onClick={doDelete} disabled={deleting}>{deleting ? t('event.deleting') : t('common.delete')}</Btn>
        </>
      ) : (
        <>
          {canEdit && <Btn variant="ghost" icon="trash" onClick={() => setConfirmDel(true)}>{t('common.delete')}</Btn>}
          <span style={{ flex: 1 }} />
          {canEdit && <Btn variant="primary" icon="edit" onClick={() => setEditMode(true)}>{t('trip.edit_trip')}</Btn>}
        </>
      )}
    >
      {warning && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 11px', borderRadius: 10, background: 'var(--warning-soft)', border: '1px solid color-mix(in srgb, var(--warning) 32%, transparent)', marginBottom: 12 }}>
          <Icon name="warning" size={15} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.45 }}>{warning}</div>
        </div>
      )}
      {confirmDel ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 12, border: '1px solid color-mix(in srgb, var(--danger) 30%, var(--line))', background: 'var(--danger-soft)' }}>
          <span style={{ width: 36, height: 36, borderRadius: 9, background: 'color-mix(in srgb, var(--danger) 16%, transparent)', color: 'var(--danger)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="trash" size={17} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{t('event.delete_q', { label: vm.themeLabel.toLowerCase() })}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 3, lineHeight: 1.5 }}>{t('event.delete_irreversible')}</div>
          </div>
        </div>
      ) : (
        <EventViewSections
          kind={kind} entity={data} fromVisit={fromVisit} toVisit={toVisit}
          accent={accent} docs={docs} canEdit={canEdit} uploading={uploading} uploadFiles={uploadFiles}
        />
      )}
    </PanelShell>
  );
}
