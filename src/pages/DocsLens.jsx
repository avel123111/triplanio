/**
 * DocsLens - documents tab inside TripView.
 *
 * Props:
 *   tripId     - string
 *   isLoading  - boolean (parent loading state, passed as fallback)
 *
 * Reads/writes trip_documents table directly via Supabase client.
 * visibility: 'shared' = all members see it; 'private' = only the creator.
 * Files are uploaded to Supabase Storage bucket 'documents'.
 */
import React, { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { safeStorageName } from '@/lib/storage';
import { useAuth } from '@/lib/AuthContext';
import { Icon } from '../design/icons';
import { Badge, Btn, Dialog, Field, Skeleton } from '../design/index';
import { useI18n } from '@/lib/i18n/I18nContext';
import { FieldError, IssuesPanel, fieldHasError, useHybridValidation } from '@/components/common/ValidationUI';

// ─── query key ────────────────────────────────────────────────────────────────

const DOCS_KEY = (tripId) => ['trip-docs', tripId];

// ─── AddDocDialog ─────────────────────────────────────────────────────────────

function AddDocDialog({ tripId, defaultVisibility = 'shared' }) {
  const { t } = useI18n();
  const [title,      setTitle]      = useState('');
  const [notes,      setNotes]      = useState('');
  const [linkUrl,    setLinkUrl]    = useState('');
  const [visibility, setVisibility] = useState(defaultVisibility);
  const [documents,  setDocuments]  = useState([]); // [{ file_url, file_name, storage_path }]
  const [saving,     setSaving]     = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [err,        setErr]        = useState('');
  const fileInputRef = useRef(null);
  const qc   = useQueryClient();
  const { user } = useAuth();
  const v = useHybridValidation('document', { title });
  const inv = (f) => (fieldHasError(v.displayIssues, f) ? 'tv-invalid' : '');

  async function uploadFiles(files) {
    if (!files?.length) return;
    setUploading(true);
    setErr('');
    try {
      const uploaded = [];
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) {
          setErr(t('doc.file_too_big', { name: file.name }));
          continue;
        }
        const path = `${tripId}/${Date.now()}-${safeStorageName(file.name)}`;
        const { error: uploadErr } = await supabase.storage.from('documents').upload(path, file);
        if (uploadErr) { setErr(uploadErr.message); continue; }
        const { data: urlData } = await supabase.storage.from('documents').createSignedUrl(path, 315360000);
        uploaded.push({ file_url: urlData?.signedUrl || '', file_name: file.name, storage_path: path });
      }
      if (uploaded.length) setDocuments(prev => [...prev, ...uploaded]);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function save() {
    setSaving(true); setErr('');
    const { error } = await supabase.from('trip_documents').insert({
      trip_id:    tripId,
      title:      title.trim(),
      notes:      notes.trim()   || null,
      link_url:   linkUrl.trim() || null,
      documents:  documents.length ? documents : null,
      visibility,
      created_by: user?.id ?? null,
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    qc.invalidateQueries({ queryKey: DOCS_KEY(tripId) });
    window.__closeModal?.();
  }

  return (
    <Dialog title={t('doc.shared_empty')} icon="file" size=""
      foot={<>
        <Btn variant="ghost" onClick={() => window.__closeModal?.()}>{t('trip.form_cancel')}</Btn>
        <Btn variant="primary" loading={saving} disabled={uploading} aria-disabled={!v.canSubmit} onClick={() => v.attemptSubmit(save)}>{t('trip.form_save')}</Btn>
      </>}>

      <IssuesPanel issues={v.panelIssues} style={{ marginBottom: 12 }} />
      {err && <div style={{ color: 'var(--danger)', fontSize: 12.5, marginBottom: 12 }}>{err}</div>}

      {/* Visibility - two card buttons, as in base44 */}
      <div style={{ marginBottom: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>{t('doc.access_label')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { value: 'shared',  icon: 'users', label: t('doc.visibility_shared'),   desc: t('doc.visibility_shared_hint') },
            { value: 'private', icon: 'lock',  label: t('doc.visibility_private'),  desc: t('doc.visibility_private_hint') },
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setVisibility(opt.value)}
              style={{
                border: `2px solid ${visibility === opt.value ? 'var(--brand)' : 'var(--line)'}`,
                background: visibility === opt.value ? 'var(--brand-soft)' : 'transparent',
                borderRadius: 12, padding: '10px 12px', textAlign: 'left', cursor: 'pointer',
                transition: 'border-color .15s, background .15s',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                <Icon name={opt.icon} size={13} style={{ color: visibility === opt.value ? 'var(--brand)' : 'var(--muted)' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: visibility === opt.value ? 'var(--brand)' : 'var(--ink)' }}>
                  {opt.label}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.4 }}>{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Title */}
      <Field label={t('trip.form_title_required')}>
        <div data-vfield="title" className={inv('title')}>
          <input className="input" autoFocus value={title} onChange={e => { setTitle(e.target.value); v.markTouched('title'); }} placeholder={t('doc.title_ph')} />
        </div>
        <FieldError issues={v.displayIssues} field="title" />
      </Field>

      {/* Notes */}
      <div style={{ marginTop: 14 }}>
        <Field label={t('doc.notes_opt_label')}>
          <textarea className="textarea" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('doc.notes_ph')} />
        </Field>
      </div>

      {/* Link */}
      <div style={{ marginTop: 14 }}>
        <Field label={t('doc.link_label')}>
          <input className="input" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://…" />
        </Field>
      </div>

      {/* File upload */}
      <div style={{ marginTop: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          <Icon name="paperclip" size={12} style={{ marginRight: 4, verticalAlign: -1, color: 'var(--brand)' }} />
          {t('doc.files_label')}
          {documents.length > 0 && <span className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>· {documents.length}</span>}
        </div>

        {/* Uploaded file list */}
        {documents.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
            {documents.map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--wash)', borderRadius: 8, border: '1px solid var(--line-2)' }}>
                <Icon name="file" size={13} style={{ color: 'var(--brand)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.file_name}</span>
                <button
                  type="button"
                  onClick={() => setDocuments(prev => prev.filter((_, j) => j !== i))}
                  style={{ width: 20, height: 20, border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', display: 'grid', placeItems: 'center', borderRadius: 4, flexShrink: 0 }}>
                  <Icon name="close" size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Drop zone */}
        <div
          onClick={() => !uploading && fileInputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); uploadFiles(e.dataTransfer.files); }}
          style={{
            border: '1.5px dashed var(--line)', borderRadius: 10, padding: '18px 14px',
            textAlign: 'center', cursor: uploading ? 'default' : 'pointer',
            background: 'var(--wash)', transition: 'border-color .15s',
          }}
          onMouseEnter={e => { if (!uploading) e.currentTarget.style.borderColor = 'var(--brand)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; }}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,image/*,.doc,.docx,.xls,.xlsx"
            style={{ display: 'none' }}
            onChange={e => uploadFiles(e.target.files)}
          />
          {uploading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--brand)', fontSize: 13 }}>
              <div style={{ width: 14, height: 14, border: '2px solid var(--brand)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
              {t('common.loading')}
            </div>
          ) : (
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              <Icon name="upload" size={16} style={{ display: 'block', margin: '0 auto 6px' }} />
              {documents.length === 0
                ? t('doc.upload_label')
                : t('doc.add_more_files')}
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Dialog>
  );
}

// ─── DocDetailDialog ──────────────────────────────────────────────────────────

function DocDetailDialog({ doc, tripId }) {
  const { t } = useI18n();
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();

  async function handleDelete() {
    if (!window.confirm(t('doc.delete_confirm', { name: doc.title }))) return;
    setDeleting(true);
    await supabase.from('trip_documents').delete().eq('id', doc.id);
    qc.invalidateQueries({ queryKey: DOCS_KEY(tripId) });
    window.__closeModal?.();
  }

  return (
    <Dialog title={doc.title} icon="file" size=""
      foot={<>
        <Btn variant="danger" loading={deleting} icon="trash" onClick={handleDelete}>{t('trip.delete')}</Btn>
        <div style={{ flex: 1 }} />
        <Btn variant="ghost" onClick={() => window.__closeModal?.()}>{t('common.close')}</Btn>
      </>}>
      {doc.notes && (
        <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--ink-2)', marginBottom: 14 }}>{doc.notes}</div>
      )}
      {doc.link_url && (
        <div style={{ marginBottom: 12 }}>
          <a href={doc.link_url} target="_blank" rel="noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--brand)', fontSize: 13.5 }}>
            <Icon name="external" size={13} />
            {doc.link_url}
          </a>
        </div>
      )}
      {doc.documents?.length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 8 }}>{t('doc.files_label')}</div>
          {doc.documents.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--line-2)' }}>
              <Icon name="file" size={14} style={{ color: 'var(--brand)', flexShrink: 0 }} />
              <a href={f.file_url} target="_blank" rel="noreferrer"
                style={{ fontSize: 13, color: 'var(--brand)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.file_name || f.file_url}
              </a>
            </div>
          ))}
        </div>
      )}
      {!doc.notes && !doc.link_url && !doc.documents?.length && (
        <div className="muted" style={{ fontSize: 13 }}>{t('doc.no_content')}</div>
      )}
    </Dialog>
  );
}

// ─── DocCard ──────────────────────────────────────────────────────────────────

function DocCard({ doc, tripId, scope }) {
  const { t } = useI18n();
  return (
    <button
      onClick={() => window.__openModal?.(<DocDetailDialog doc={doc} tripId={tripId} />)}
      style={{
        padding: 14, background: 'var(--surface)', border: '1px solid var(--line)',
        borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 8,
        cursor: 'pointer', textAlign: 'left',
        transition: 'border-color .15s, transform .1s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#dbe1ec'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.transform = ''; }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 9,
          background: scope === 'personal' ? 'var(--warm-tint)' : 'var(--brand-soft)',
          color:      scope === 'personal' ? 'var(--warm)'     : 'var(--brand)',
          display: 'grid', placeItems: 'center',
        }}>
          <Icon name="file" size={17} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {(doc.documents?.length || 0)} {doc.documents?.length === 1 ? t('doc.files_count_one') : t('doc.files_count_few')}
            {doc.link_url && t('doc.has_link')}
          </div>
        </div>
      </div>
      {doc.notes && (
        <div className="muted" style={{
          fontSize: 12.5, lineHeight: 1.5,
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
        }}>{doc.notes}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
        {doc.link_url && (
          <Badge variant="quiet" icon="external">
            {doc.link_url.replace(/^https?:\/\//, '').split('/')[0]}
          </Badge>
        )}
      </div>
    </button>
  );
}

// ─── DocEmpty ─────────────────────────────────────────────────────────────────

function DocEmpty({ scope, tripId }) {
  const { t } = useI18n();
  return (
    <div style={{ padding: '32px 24px', textAlign: 'center', border: '1.5px dashed var(--line)', borderRadius: 14, background: 'var(--wash)' }}>
      <div style={{
        width: 56, height: 56, margin: '0 auto 12px', borderRadius: 14,
        background: scope === 'personal' ? 'var(--warm-tint)' : 'var(--brand-soft)',
        color:      scope === 'personal' ? 'var(--warm)'     : 'var(--brand)',
        display: 'grid', placeItems: 'center',
      }}>
        <Icon name="file" size={26} />
      </div>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
        {scope === 'personal' ? t('doc.empty_private') : t('doc.empty_shared')}
      </div>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5, maxWidth: 360, margin: '0 auto 14px' }}>
        {scope === 'personal'
          ? t('doc.empty_private_desc')
          : t('doc.empty_shared_desc')}
      </div>
      <Btn variant="ghost" icon="plus"
        onClick={() => window.__openModal?.(<AddDocDialog tripId={tripId} defaultVisibility={scope === 'personal' ? 'private' : 'shared'} />)}>
        {t('doc.add_doc')}
      </Btn>
    </div>
  );
}

// ─── DocsGrid ─────────────────────────────────────────────────────────────────

function DocsGrid({ docs, scope, tripId }) {
  const { t } = useI18n();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
      {docs.map(d => (
        <DocCard key={d.id} doc={d} tripId={tripId} scope={scope} />
      ))}
      <button
        onClick={() => window.__openModal?.(<AddDocDialog tripId={tripId} defaultVisibility={scope === 'personal' ? 'private' : 'shared'} />)}
        style={{
          padding: 14, background: 'transparent', border: '1.5px dashed var(--line)',
          borderRadius: 12, color: 'var(--muted)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 130,
          transition: 'border-color .15s, color .15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = scope === 'personal' ? 'var(--warm)' : 'var(--brand)';
          e.currentTarget.style.color       = scope === 'personal' ? 'var(--warm)' : 'var(--brand)';
        }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--muted)'; }}>
        <Icon name="plus" size={18} />
        <span>{t('doc.shared_empty')}</span>
      </button>
    </div>
  );
}

// ─── DocsLens (main export) ───────────────────────────────────────────────────

export default function DocsLens({ tripId, isLoading: parentLoading }) {
  const { t } = useI18n();
  const { user } = useAuth();

  const { data: docs = [], isLoading, error } = useQuery({
    queryKey: DOCS_KEY(tripId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trip_documents')
        .select('*')
        .eq('trip_id', tripId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!tripId,
  });

  const sharedDocs   = docs.filter(d => d.visibility === 'shared');
  const personalDocs = docs.filter(d => d.visibility === 'private' && d.created_by === user?.id);

  if (isLoading || parentLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton w="100%" h={36} r={8} />
        <Skeleton w="100%" h={180} r={12} />
        <Skeleton w="100%" h={180} r={12} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--danger)' }}>
        <Icon name="error" size={32} style={{ marginBottom: 10 }} />
        <div>{t('doc.load_error', { message: error.message })}</div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <h2 style={{ flex: 1 }}>{t('doc.page_title')}</h2>
        <Btn variant="primary" icon="plus"
          onClick={() => window.__openModal?.(<AddDocDialog tripId={tripId} />)}>
          {t('doc.add_doc')}
        </Btn>
      </div>

      {/* Shared section */}
      <section style={{ marginBottom: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Icon name="users" size={14} style={{ color: 'var(--brand)' }} />
          <h3 style={{ marginBottom: 0 }}>{t('doc.section_shared')}</h3>
          <Badge variant="quiet">{sharedDocs.length}</Badge>
          <div style={{ flex: 1 }} />
          <div className="muted" style={{ fontSize: 11.5 }}>{t('doc.section_shared_hint')}</div>
        </div>
        {sharedDocs.length === 0
          ? <DocEmpty scope="shared" tripId={tripId} />
          : <DocsGrid docs={sharedDocs} scope="shared" tripId={tripId} />}
      </section>

      {/* Personal section */}
      <section style={{ marginBottom: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Icon name="user" size={14} style={{ color: 'var(--warm)' }} />
          <h3 style={{ marginBottom: 0 }}>{t('doc.section_private')}</h3>
          <Badge variant="quiet">{personalDocs.length}</Badge>
          <div style={{ flex: 1 }} />
          <div className="muted" style={{ fontSize: 11.5 }}>{t('doc.section_private_hint')}</div>
        </div>
        {personalDocs.length === 0
          ? <DocEmpty scope="personal" tripId={tripId} />
          : <DocsGrid docs={personalDocs} scope="personal" tripId={tripId} />}
      </section>
    </>
  );
}
