/**
 * EsimDialog — unified view + edit dialog for kind="esim" trip services.
 *
 * View mode:  Lumo-styled header (esim color), sections for cost / notes / docs.
 * Edit mode:  Form — name, price, currency, notes, documents[].
 *             Extra fields (notes, documents) stored in details JSONB.
 *
 * Uses Dialog/DialogContent from @/components/ui/dialog (Radix, ESC close,
 * auto bottom-sheet at ≤640 px via .dlg-modal CSS).
 *
 * Props:
 *   open          bool
 *   onOpenChange  (bool) => void
 *   tripId        uuid
 *   service       trip_services row | null   — null = create mode
 *   canEdit       bool
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Btn, Field } from '@/design/index';
import { Loader2, Wifi, Trash2, Edit2, X, FileText, ExternalLink } from 'lucide-react';
import DocumentsField from '@/components/common/DocumentsField';
import CurrencyCombobox from '@/components/ui/CurrencyCombobox';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { invalidateTripData } from '@/lib/trip-data';
import { fmtMoneyActive } from '@/lib/i18n/format';

// ─── Lumo tokens for eSIM (matches design: --ev-esim, --ev-esim-ink, --ev-esim-soft) ───
const ESIM_COLOR  = 'var(--ev-esim)';
const ESIM_INK    = 'var(--ev-esim-ink)';
const ESIM_SOFT   = 'var(--ev-esim-soft)';
const ESIM_SOFT2  = 'var(--ev-esim-soft-2)';

// ─── Small shared primitives ────────────────────────────────────────────────

function SectionLabel({ children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 7,
      fontSize: 10, fontWeight: 800, textTransform: 'uppercase',
      letterSpacing: '.06em', color: ESIM_COLOR, marginBottom: 6,
    }}>
      <span style={{ width: 3, height: 12, borderRadius: 2, background: ESIM_COLOR, flexShrink: 0 }} />
      {children}
      <span style={{ flex: 1, height: 1, background: `color-mix(in srgb, ${ESIM_COLOR} 18%, transparent)` }} />
    </div>
  );
}

function SecCard({ children }) {
  return (
    <div style={{
      background: 'var(--surface-3)', border: '1px solid var(--line-2)',
      borderRadius: 'var(--r-md)', padding: '13px 14px',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {children}
    </div>
  );
}

function KVGrid({ children }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px 13px' }}>
      {children}
    </div>
  );
}

function KV({ label, children, mono, full }) {
  if (!children && children !== 0) return null;
  return (
    <div style={full ? { gridColumn: '1 / -1' } : {}}>
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', fontFamily: mono ? 'var(--font-mono)' : undefined }}>{children}</div>
    </div>
  );
}

// ─── View Mode ───────────────────────────────────────────────────────────────

function EsimView({ service, t, onEdit, onDelete, onClose, canEdit, deleting, confirmDel, setConfirmDel }) {
  const d = service.details || {};
  const price = service.price;
  const cur = service.currency || 'EUR';
  const docs = Array.isArray(d.documents) ? d.documents : [];
  const priceText = price != null ? fmtMoneyActive(Number(price), cur) : null;

  return (
    <>
      {/* Coloured header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '18px 20px 16px', background: ESIM_SOFT,
        borderBottom: '1px solid var(--line-2)', position: 'relative',
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 14, background: ESIM_COLOR,
          color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0,
          boxShadow: `0 4px 12px -4px color-mix(in srgb, ${ESIM_COLOR} 50%, transparent)`,
        }}>
          <Wifi style={{ width: 21, height: 21 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: ESIM_INK, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>
            {t('service.esim_eyebrow')}
          </div>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {service.name}
          </h2>
        </div>
        {priceText && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 700, color: 'var(--ink)' }}>{priceText}</div>
          </div>
        )}
        <button
          onClick={onClose}
          style={{ width: 30, height: 30, borderRadius: 9, border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0 }}
        >
          <X style={{ width: 15, height: 15 }} />
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: '15px 20px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 11 }}>
        {confirmDel ? (
          <div style={{ borderRadius: 12, border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', background: 'var(--danger-soft)', padding: 16, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'color-mix(in srgb, var(--danger) 15%, transparent)', color: 'var(--danger-ink)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Trash2 style={{ width: 20, height: 20 }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{t('event.delete_q', { label: 'eSIM' })}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>{t('event.delete_irreversible')}</div>
            </div>
          </div>
        ) : (
          <>
            {/* Cost */}
            <SecCard>
              <SectionLabel>{t('service.esim_cost_section')}</SectionLabel>
              <KVGrid>
                <KV label={t('budget.field_amount')}>{priceText}</KV>
                <KV label={t('service.currency')}>{cur}</KV>
              </KVGrid>
            </SecCard>

            {/* Notes */}
            {d.notes && (
              <SecCard>
                <SectionLabel>{t('service.notes')}</SectionLabel>
                <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{d.notes}</div>
              </SecCard>
            )}

            {/* Documents */}
            {docs.length > 0 && (
              <SecCard>
                <SectionLabel>{t('service.esim_docs_section')} · {docs.length}</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {docs.map((doc, i) => (
                    <a
                      key={`${doc.file_url}-${i}`}
                      href={doc.file_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--surface)', textDecoration: 'none', color: 'var(--ink-2)', fontSize: 13, fontWeight: 700, transition: 'background .12s' }}
                    >
                      <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--surface-2)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                        <FileText style={{ width: 13, height: 13, color: 'var(--muted)' }} />
                      </div>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.file_name || t('event.file_word')}</span>
                      <ExternalLink style={{ width: 12, height: 12, color: 'var(--muted-2)', flexShrink: 0 }} />
                    </a>
                  ))}
                </div>
              </SecCard>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '11px 20px', borderTop: '1px solid var(--line-2)', background: 'var(--wash)', display: 'flex', gap: 7, alignItems: 'center' }}>
        {confirmDel ? (
          <>
            <div style={{ flex: 1 }} />
            <Btn variant="ghost" size="sm" onClick={() => setConfirmDel(false)} disabled={deleting}>{t('common.cancel')}</Btn>
            <Btn variant="danger-solid" size="sm" disabled={deleting} onClick={onDelete}>
              {deleting ? <Loader2 style={{ width: 14, height: 14, marginRight: 6, animation: 'spin .7s linear infinite' }} /> : <Trash2 style={{ width: 14, height: 14, marginRight: 6 }} />}
              {t('trip.delete')}
            </Btn>
          </>
        ) : (
          <>
            {canEdit && (
              <Btn variant="danger-ghost" size="sm" onClick={() => setConfirmDel(true)}>
                <Trash2 style={{ width: 14, height: 14, marginRight: 6 }} />{t('trip.delete')}
              </Btn>
            )}
            <div style={{ flex: 1 }} />
            <Btn variant="ghost" size="sm" onClick={onClose}>{t('common.close')}</Btn>
            {canEdit && (
              <Btn size="sm" onClick={onEdit} style={{ background: ESIM_COLOR, borderColor: ESIM_COLOR, color: '#fff' }}>
                <Edit2 style={{ width: 14, height: 14, marginRight: 6 }} />{t('trip.edit_trip')}
              </Btn>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ─── Edit Mode ───────────────────────────────────────────────────────────────

function EsimEdit({ service, tripId, t, onClose, onSaved, onDeleted, canEdit }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isEdit = !!service;

  const [name, setName]           = useState(service?.name || '');
  const [price, setPrice]         = useState(service?.price ?? '');
  const [currency, setCurrency]   = useState(service?.currency || 'EUR');
  const [notes, setNotes]         = useState(service?.details?.notes || '');
  const [docs, setDocs]           = useState(() => {
    const d = service?.details?.documents;
    return Array.isArray(d) ? d : [];
  });
  const [uploading, setUploading] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const invalidate = () => invalidateTripData(qc, tripId);

  const saveMut = useMutation({
    mutationFn: async () => {
      const details = { ...(service?.details || {}), notes: notes.trim() || null, documents: docs };
      const payload = {
        trip_id: tripId,
        kind: 'esim',
        name: name.trim(),
        price: price === '' ? null : Number(price),
        currency: currency || 'EUR',
        details,
      };
      if (isEdit) {
        const { data, error } = await supabase.from('trip_services').update(payload).eq('id', service.id).select().single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase.from('trip_services').insert({ ...payload, created_by: user?.id }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => { invalidate(); onSaved?.(data); onClose(); },
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('trip_services').delete().eq('id', service.id);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); onDeleted?.(); onClose(); },
  });

  const title = isEdit ? t('service.esim_edit') : t('service.esim_new');

  return (
    <>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '18px 20px 16px', background: ESIM_SOFT,
        borderBottom: '1px solid var(--line-2)',
      }}>
        <div style={{ width: 44, height: 44, borderRadius: 14, background: ESIM_COLOR, color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0, boxShadow: `0 4px 12px -4px color-mix(in srgb, ${ESIM_COLOR} 50%, transparent)` }}>
          <Wifi style={{ width: 21, height: 21 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: ESIM_INK, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>
            {t('service.esim_eyebrow')}
          </div>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.2 }}>{title}</h2>
        </div>
        <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 9, border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer', flexShrink: 0 }}>
          <X style={{ width: 15, height: 15 }} />
        </button>
      </div>

      {/* Body */}
      <div style={{ padding: '15px 20px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label={`${t('service.name')} *`}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Airalo 5GB, Holafly…" autoFocus />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 9 }}>
          <Field label={t('service.price')}>
            <input className="input" type="number" step="0.01" value={price}
              onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
          </Field>
          <Field label={t('service.currency')}>
            <CurrencyCombobox value={currency} onChange={setCurrency} />
          </Field>
        </div>

        <Field label={t('service.notes')}>
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder={t('service.esim_notes_ph')} style={{ minHeight: 72 }} />
        </Field>

        {/* Docs section */}
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: ESIM_COLOR, display: 'flex', alignItems: 'center', gap: 7, margin: '4px 0 8px' }}>
            {t('service.esim_docs_section')}
            <span style={{ flex: 1, height: 1, background: `color-mix(in srgb, ${ESIM_COLOR} 18%, transparent)` }} />
          </div>
          <DocumentsField
            value={docs}
            onChange={setDocs}
            onUploadingChange={setUploading}
            label={t('service.docs')}
            bare
          />
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '11px 20px', borderTop: '1px solid var(--line-2)', background: 'var(--wash)', display: 'flex', gap: 7, alignItems: 'center' }}>
        {isEdit && canEdit && (
          confirmDel ? (
            <>
              <div style={{ flex: 1 }} />
              <Btn variant="ghost" size="sm" onClick={() => setConfirmDel(false)}>{t('common.cancel')}</Btn>
              <Btn variant="danger-solid" size="sm" disabled={deleteMut.isPending} onClick={() => deleteMut.mutate()}>
                {deleteMut.isPending ? <Loader2 style={{ width: 14, height: 14, marginRight: 6, animation: 'spin .7s linear infinite' }} /> : <Trash2 style={{ width: 14, height: 14, marginRight: 6 }} />}
                {t('trip.delete')}
              </Btn>
            </>
          ) : (
            <Btn variant="danger-ghost" size="sm" onClick={() => setConfirmDel(true)}>
              <Trash2 style={{ width: 14, height: 14, marginRight: 6 }} />{t('common.delete')}
            </Btn>
          )
        )}
        {!confirmDel && (
          <>
            <div style={{ flex: 1 }} />
            <Btn variant="ghost" size="sm" onClick={onClose}>{t('common.cancel')}</Btn>
            <Btn
              size="sm"
              style={{ background: ESIM_COLOR, borderColor: ESIM_COLOR, color: '#fff' }}
              disabled={!name.trim() || saveMut.isPending || uploading}
              onClick={() => saveMut.mutate()}
            >
              {saveMut.isPending && <Loader2 style={{ width: 14, height: 14, marginRight: 6, animation: 'spin .7s linear infinite' }} />}
              {isEdit ? t('common.save') : t('common.add')}
            </Btn>
          </>
        )}
      </div>
    </>
  );
}

// ─── Main export ─────────────────────────────────────────────────────────────

export default function EsimDialog({ open, onOpenChange, tripId, service, canEdit = false, defaultEditMode = false }) {
  const { t } = useI18nFormat();
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(defaultEditMode || !service);
  const [deleting, setDeleting]  = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  useEffect(() => {
    if (open) {
      setEditMode(defaultEditMode || !service);
      setConfirmDel(false);
      setDeleting(false);
    }
  }, [open, service?.id]);

  const handleClose = () => onOpenChange(false);

  const handleDelete = async () => {
    if (!service) return;
    try {
      setDeleting(true);
      const { error } = await supabase.from('trip_services').delete().eq('id', service.id);
      if (error) throw error;
      invalidateTripData(qc, tripId);
      onOpenChange(false);
    } finally {
      setDeleting(false);
      setConfirmDel(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dlg--sm" style={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {editMode ? (
          <EsimEdit
            service={service}
            tripId={tripId}
            t={t}
            onClose={handleClose}
            onSaved={() => {}}
            onDeleted={() => {}}
            canEdit={canEdit}
          />
        ) : (
          <EsimView
            service={service}
            t={t}
            onEdit={() => setEditMode(true)}
            onDelete={handleDelete}
            onClose={handleClose}
            canEdit={canEdit}
            deleting={deleting}
            confirmDel={confirmDel}
            setConfirmDel={setConfirmDel}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
