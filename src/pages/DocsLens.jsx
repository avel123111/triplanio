/**
 * DocsLens - documents tab inside TripView.
 *
 * Props:
 *   tripId     - string
 *   isLoading  - boolean (parent loading state, passed as fallback)
 *   members    - trip_members rows (user_id, user_full_name, avatar_url)
 *
 * Reads/writes trip_documents table directly via Supabase client.
 * visibility: 'shared' = all members see it; 'private' = only the creator.
 * Files are uploaded to the private Supabase Storage bucket 'trips' under
 * `<tripId>/<uid>-<file>`.
 *
 * Visual: Lumo redesign (2026-06-08). Page-scoped styles in DocsLens.css
 * (.dl-* on app.css tokens). Dialogs use Radix ui/dialog (dlg__head /
 * dlg__body / dlg__foot structure). No inline hover handlers — CSS only.
 */
import React, { useState, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { TRIP_BUCKET, SIGNED_URL_TTL, tripStoragePath } from '@/lib/storage';
import { useAuth } from '@/lib/AuthContext';
import { Icon } from '../design/icons';
import { Avatar, Badge, Btn, Field, Severity, Skeleton, DialogRoot as Dialog, DialogContent, DialogTitle } from '../design/index';
import { useUserProfiles } from '@/lib/useUserProfiles';
import { resolveAuthor } from '@/lib/resolveAuthor';
import { useIsMobile } from '@/hooks/use-mobile';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useConfirm } from '@/components/common/ConfirmProvider';
import { FieldError, IssuesPanel, fieldHasError, useHybridValidation } from '@/components/common/ValidationUI';
import './DocsLens.css';

// ─── query key ────────────────────────────────────────────────────────────────

const DOCS_KEY = (tripId) => ['trip-docs', tripId];

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Classify a file by extension for the colour-coded type badge. */
function fileType(name = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'xls';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'avif'].includes(ext)) return 'img';
  return 'file';
}

/** Inline file chip used in both cards and the detail dialog. */
function FileChip({ file }) {
  const type = fileType(file.file_name);
  return (
    <div className="dl-filechip">
      <span className={`dl-ftag dl-ftag--${type}`}>
        <Icon name="file" size={15} />
      </span>
      <span className="dl-filechip__n">{file.file_name}</span>
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── AddDocDialog ─────────────────────────────────────────────────────────────

export function AddDocDialog({ tripId, defaultVisibility = 'shared', open, onOpenChange }) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const close = () => onOpenChange?.(false);

  const [title,      setTitle]      = useState('');
  const [notes,      setNotes]      = useState('');
  const [linkUrl,    setLinkUrl]    = useState('');
  const [visibility, setVisibility] = useState(defaultVisibility);
  const [documents,  setDocuments]  = useState([]); // [{ file_url, file_name, storage_path }]
  const [saving,     setSaving]     = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [err,        setErr]        = useState('');
  const fileInputRef = useRef(null);
  const qc           = useQueryClient();
  const { user }     = useAuth();
  const v    = useHybridValidation('document', { title });
  const inv  = (f) => (fieldHasError(v.displayIssues, f) ? 'tv-invalid' : '');

  async function uploadFiles(files) {
    if (!files?.length) return;
    setUploading(true); setErr('');
    try {
      const uploaded = [];
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) {
          setErr(t('doc.file_too_big', { name: file.name }));
          continue;
        }
        const path = tripStoragePath(tripId, file.name);
        const { error: uploadErr } = await supabase.storage.from(TRIP_BUCKET).upload(path, file);
        if (uploadErr) { setErr(uploadErr.message); continue; }
        const { data: urlData } = await supabase.storage.from(TRIP_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
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
      // Author-name snapshot — mirrors chat_messages.user_full_name so the
      // uploader's name survives them leaving the trip (their trip_members /
      // active-profile row is gone). resolveAuthor() reads this as the fallback.
      created_by_name: (user?.full_name || '').trim() || null,
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    qc.invalidateQueries({ queryKey: DOCS_KEY(tripId) });
    close();
  }

  const visOpts = [
    {
      value: 'shared',
      icon:  'users',
      label: t('doc.visibility_shared'),
      desc:  t('doc.visibility_shared_hint'),
    },
    {
      value: 'private',
      icon:  'lock',
      label: t('doc.visibility_private'),
      desc:  t('doc.visibility_private_hint'),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* sr-only a11y title — visible h2 is inside dlg__head */}
        <DialogTitle className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{t('doc.dialog_new')}</DialogTitle>

        {/* ── Header ── */}
        <div className="dlg__head">
          <span style={{
            width: 36, height: 36, borderRadius: 9,
            background: 'var(--brand-soft)', color: 'var(--brand)',
            display: 'grid', placeItems: 'center', flexShrink: 0,
          }}>
            <Icon name="file" size={17} />
          </span>
          <h2>{t('doc.dialog_new')}</h2>
          <button className="icon-btn" onClick={close}>
            <Icon name="close" size={16} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="dlg__body">
          <IssuesPanel issues={v.panelIssues} style={{ marginBottom: 12 }} />
          {err && (
            <div style={{ marginBottom: 12 }}>
              <Severity level="error">{err}</Severity>
            </div>
          )}

          {/* Visibility */}
          <div style={{ marginBottom: 16 }}>
            <div className="dl-label">{t('doc.access_label')}</div>
            <div className="dl-vistoggle">
              {visOpts.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className={`dl-visopt${opt.value === 'private' ? ' dl-visopt--mine' : ''}${visibility === opt.value ? ' is-on' : ''}`}
                  onClick={() => setVisibility(opt.value)}>
                  <span className="dl-visopt__ic">
                    <Icon name={opt.icon} size={17} />
                  </span>
                  <span className="dl-visopt__lbl">
                    <b>{opt.label}</b>
                    <span>{opt.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <Field label={t('trip.form_title_required')}>
            <div data-vfield="title" className={inv('title')}>
              <input
                className="input"
                autoFocus={!isMobile}
                value={title}
                onChange={e => { setTitle(e.target.value); v.markTouched('title'); }}
                placeholder={t('doc.title_ph')}
              />
            </div>
            <FieldError issues={v.displayIssues} field="title" />
          </Field>

          {/* Notes */}
          <div style={{ marginTop: 14 }}>
            <Field label={t('doc.notes_opt_label')}>
              <textarea
                className="textarea"
                rows={3}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder={t('doc.notes_ph')}
              />
            </Field>
          </div>

          {/* Link */}
          <div style={{ marginTop: 14 }}>
            <Field label={t('doc.link_label')}>
              <input
                className="input"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                placeholder={t('doc.link_placeholder')}
              />
            </Field>
          </div>

          {/* Files */}
          <div style={{ marginTop: 16 }}>
            <div className="dl-label">
              <Icon name="paperclip" size={13} style={{ color: 'var(--brand)' }} />
              {t('doc.files_label')}
              {documents.length > 0 && (
                <span className="muted" style={{ fontWeight: 400, marginLeft: 4 }}>
                  · {documents.length}
                </span>
              )}
            </div>

            {/* Uploaded files list */}
            {documents.length > 0 && (
              <div className="dl-uplist">
                {documents.map((d, i) => (
                  <div key={i} className="dl-upitem">
                    <span className={`dl-ftag dl-ftag--${fileType(d.file_name)}`}>
                      <Icon name="file" size={14} />
                    </span>
                    <span className="dl-upitem__n">{d.file_name}</span>
                    <button
                      type="button"
                      className="dl-upitem__rm"
                      aria-label={t('doc.remove_doc_aria')}
                      onClick={() => setDocuments(prev => prev.filter((_, j) => j !== i))}>
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Drop zone */}
            <div
              className={`dl-dropzone${uploading ? ' is-uploading' : ''}`}
              onClick={() => !uploading && fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); uploadFiles(e.dataTransfer.files); }}>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,image/*,.doc,.docx,.xls,.xlsx"
                style={{ display: 'none' }}
                onChange={e => uploadFiles(e.target.files)}
              />
              {uploading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brand)', fontSize: 'var(--fs-base)' }}>
                  <span className="dl-spinner" />
                  {t('common.loading')}
                </div>
              ) : (
                <>
                  <Icon name="upload" size={24} />
                  <b>{documents.length === 0 ? t('doc.upload_label') : t('doc.add_more_files')}</b>
                  <span>PDF · DOC · XLS · IMG &nbsp;·&nbsp; max 10 MB</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="dlg__foot">
          <Btn variant="ghost" onClick={close}>{t('trip.form_cancel')}</Btn>
          <Btn
            variant="primary"
            loading={saving}
            disabled={uploading}
            aria-disabled={!v.canSubmit}
            onClick={() => v.attemptSubmit(save)}>
            {t('trip.form_save')}
          </Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── DocDetailDialog ──────────────────────────────────────────────────────────

function DocDetailDialog({ doc, tripId, open, onOpenChange }) {
  const { t }    = useI18n();
  const close    = () => onOpenChange?.(false);
  const confirm  = useConfirm();
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();

  async function handleDelete() {
    if (!(await confirm({ title: t('doc.delete_confirm', { name: doc.title }), variant: 'destructive' }))) return;
    setDeleting(true);
    await supabase.from('trip_documents').delete().eq('id', doc.id);
    qc.invalidateQueries({ queryKey: DOCS_KEY(tripId) });
    close();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{doc.title}</DialogTitle>

        {/* ── Header ── */}
        <div className="dlg__head">
          <span style={{
            width: 36, height: 36, borderRadius: 9,
            background: 'var(--brand-soft)', color: 'var(--brand)',
            display: 'grid', placeItems: 'center', flexShrink: 0,
          }}>
            <Icon name="file" size={17} />
          </span>
          <h2>{doc.title}</h2>
          <button className="icon-btn" onClick={close}>
            <Icon name="close" size={16} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="dlg__body">
          {doc.notes && (
            <p className="dl-dview-note">{doc.notes}</p>
          )}

          {doc.link_url && (
            <a className="dl-dview-link" href={doc.link_url} target="_blank" rel="noreferrer">
              <Icon name="external" size={16} />
              <b>{doc.link_url}</b>
            </a>
          )}

          {doc.documents?.length > 0 && (
            <div>
              <div className="dl-label" style={{ marginTop: doc.notes || doc.link_url ? 14 : 0 }}>
                <Icon name="paperclip" size={13} style={{ color: 'var(--brand)' }} />
                {t('doc.files_label')}
              </div>
              <div className="dl-dview-files">
                {doc.documents.map((f, i) => (
                  <div key={i} className="dl-filechip">
                    <span className={`dl-ftag dl-ftag--${fileType(f.file_name)}`}>
                      <Icon name="file" size={14} />
                    </span>
                    <a
                      href={f.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="dl-filechip__n"
                      style={{ color: 'var(--brand)' }}>
                      {f.file_name || f.file_url}
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!doc.notes && !doc.link_url && !doc.documents?.length && (
            <div className="muted" style={{ fontSize: 'var(--fs-base)' }}>
              {t('doc.no_content')}
            </div>
          )}

          {doc.created_at && (
            <div className="dl-dview-meta">
              <Icon name="calendar" size={13} />
              {formatDate(doc.created_at)}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="dlg__foot">
          <Btn variant="danger" loading={deleting} icon="trash" onClick={handleDelete}>
            {t('trip.delete')}
          </Btn>
          <div style={{ flex: 1 }} />
          <Btn variant="ghost" onClick={close}>{t('common.close')}</Btn>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── DocCard ──────────────────────────────────────────────────────────────────

function DocCard({ doc, scope, members, profiles, onOpenDetail }) {
  const { t }    = useI18n();
  const { user } = useAuth();
  const files    = doc.documents || [];
  const shown    = files.slice(0, 2);
  const more     = files.length - shown.length;
  const isShared = scope !== 'personal';

  // Uploader info via the shared resolver (same mechanism as chat): falls back
  // to the created_by_name snapshot so a doc whose author has LEFT the trip
  // still shows their name + gradient-initials avatar instead of "?".
  const uploader = useMemo(() => {
    if (!isShared) return { name: null, photo: null, deleted: false }; // personal → "Только вы"
    return resolveAuthor({
      userId: doc.created_by,
      nameSnapshot: doc.created_by_name,
      profiles,
      members,
      selfUser: user,
      deletedLabel: t('common.deleted_user'),
    });
  }, [doc.created_by, doc.created_by_name, profiles, members, isShared, user, t]);

  return (
    <button
      className="dl-card dz-lift-card"
      onClick={() => onOpenDetail?.(doc)}>

      {/* Icon + title + visibility chip */}
      <div className="dl-card__top">
        <div className={`dl-card__ic dl-card__ic--${isShared ? 'shared' : 'mine'}`}>
          <Icon name="file" size={20} />
        </div>
        <div className="dl-card__h">
          <div className="dl-card__title">{doc.title}</div>
          <div className="dl-card__sub">
            {files.length > 0
              ? `${files.length} ${files.length === 1 ? t('doc.files_count_one') : t('doc.files_count_few')}`
              : t('doc.card_no_files')}
            {doc.link_url && t('doc.has_link')}
          </div>
        </div>
        <span className={`dl-vischip dl-vischip--${isShared ? 'shared' : 'mine'}`}>
          <Icon name={isShared ? 'users' : 'lock'} size={11} />
        </span>
      </div>

      {/* Notes excerpt */}
      {doc.notes && (
        <div className="dl-card__notes">{doc.notes}</div>
      )}

      {/* File chips (max 2) */}
      {shown.length > 0 && (
        <div className="dl-filechips">
          {shown.map((f, i) => <FileChip key={i} file={f} />)}
          {more > 0 && (
            <span className="dl-filemore">+{more} {t('doc.files_count_few')}</span>
          )}
        </div>
      )}

      {/* Link row (visual, non-navigating — detail dialog has the real link) */}
      {doc.link_url && (
        <div className="dl-linkrow">
          <Icon name="external" size={14} style={{ color: 'var(--ev-hotel-ink)', flexShrink: 0 }} />
          <b>{doc.link_url.replace(/^https?:\/\//, '').split('/')[0]}</b>
          <Icon name="chev" size={13} style={{ color: 'var(--ev-hotel-ink)', opacity: .55 }} />
        </div>
      )}

      {/* Footer: avatar + name + date */}
      <div className="dl-card__foot">
        {isShared ? (
          <>
            <Avatar name={uploader.name} photo={uploader.photo} deleted={uploader.deleted} size="sm" />
            <span className="dl-card__foot-who">{uploader.name}</span>
          </>
        ) : (
          <>
            <Avatar name={user?.full_name || '?'} size="sm" />
            <span className="dl-card__foot-who">{t('doc.only_you')}</span>
          </>
        )}
        <span className="dl-card__foot-date">{formatDate(doc.created_at)}</span>
      </div>
    </button>
  );
}

// ─── DocEmpty ─────────────────────────────────────────────────────────────────

function DocEmpty({ scope, onOpenAdd }) {
  const { t }    = useI18n();
  const isShared = scope !== 'personal';
  return (
    <div className="dl-empty">
      <div className={`dl-empty__ic dl-empty__ic--${isShared ? 'shared' : 'mine'}`}>
        <Icon name="file" size={28} />
      </div>
      <b>{isShared ? t('doc.empty_shared') : t('doc.empty_private')}</b>
      <span>{isShared ? t('doc.empty_shared_desc') : t('doc.empty_private_desc')}</span>
      <Btn
        variant="soft"
        size="sm"
        icon="plus"
        style={!isShared ? { background: 'var(--warm-soft)', color: 'var(--warm-ink)' } : undefined}
        onClick={() => onOpenAdd?.()}>
        {t('doc.add_doc')}
      </Btn>
    </div>
  );
}

// ─── DocsGrid ─────────────────────────────────────────────────────────────────

function DocsGrid({ docs, scope, members, profiles, onOpenAdd, onOpenDetail }) {
  const { t }    = useI18n();
  const isShared = scope !== 'personal';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
      {docs.map(d => (
        <DocCard key={d.id} doc={d} scope={scope} members={members} profiles={profiles} onOpenDetail={onOpenDetail} />
      ))}
      <button
        className={`dl-addcard${!isShared ? ' dl-addcard--mine' : ''}`}
        onClick={() => onOpenAdd?.()}>
        <span className="dl-addcard__ic">
          <Icon name="plus" size={22} />
        </span>
        <b>{t('doc.add_doc')}</b>
      </button>
    </div>
  );
}

// ─── DocsLens (main export) ───────────────────────────────────────────────────

export default function DocsLens({ tripId, isLoading: parentLoading, members = [] }) {
  const { t }    = useI18n();
  const { user } = useAuth();
  const [addDocVis,    setAddDocVis]    = useState(null); // null | { defaultVisibility }
  const [detailDoc,    setDetailDoc]    = useState(null); // null | doc object
  const [searchQuery,  setSearchQuery]  = useState('');
  const [filter,       setFilter]       = useState('all'); // 'all' | 'files' | 'links'

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

  // Resolve real author identity (name/avatar/is_deleted) for every doc creator
  // and member via the shared profile resolver — same source as other screens.
  const profileIds = useMemo(() => {
    const ids = new Set();
    docs.forEach(d => { if (d.created_by) ids.add(d.created_by); });
    members.forEach(m => { if (m.user_id) ids.add(m.user_id); });
    return Array.from(ids);
  }, [docs, members]);
  const profiles = useUserProfiles(profileIds, tripId);

  // Search + filter (applied after visibility split)
  const filterDoc = (d) => {
    if (searchQuery && !d.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filter === 'files'  && !d.documents?.length) return false;
    if (filter === 'links'  && !d.link_url)          return false;
    return true;
  };

  const sharedDocs   = docs.filter(d => d.visibility === 'shared'                          && filterDoc(d));
  const personalDocs = docs.filter(d => d.visibility === 'private' && d.created_by === user?.id && filterDoc(d));
  // Raw counts (unfiltered) for badges
  const sharedTotal   = docs.filter(d => d.visibility === 'shared').length;
  const personalTotal = docs.filter(d => d.visibility === 'private' && d.created_by === user?.id).length;

  // The "add document" affordance lives in the screen body itself — each section
  // shows a DocEmpty CTA (when empty) or a DocsGrid add-card (`dl-addcard`), so
  // the removed per-screen bar didn't need a replacement button.

  if (isLoading || parentLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Skeleton w="100%" h={44} r={22} />
        <Skeleton w="100%" h={180} r={12} />
        <Skeleton w="100%" h={180} r={12} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32 }}>
        <Severity level="error">{t('doc.load_error', { message: error.message })}</Severity>
      </div>
    );
  }

  const filterOpts = [
    { key: 'all',   label: t('doc.filter_all') },
    { key: 'files', label: t('doc.filter_files') },
    { key: 'links', label: t('doc.filter_links') },
  ];

  return (
    <div className="dl-root ov-anim">
      {/* ── Toolbar: search + filter ── */}
      <div className="dl-toolbar">
        <label className="dl-search">
          <span className="dl-search__icon"><Icon name="search" size={16} /></span>
          <input
            type="search"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('doc.search_ph')}
          />
        </label>
        <div className="seg" role="group" aria-label={t('doc.filter_label')}>
          {filterOpts.map(opt => (
            <button
              key={opt.key}
              aria-pressed={filter === opt.key}
              onClick={() => setFilter(opt.key)}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Shared section ── */}
      <section style={{ marginBottom: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14 }}>
          <div className="dl-sec-ic dl-sec-ic--shared">
            <Icon name="users" size={17} />
          </div>
          <div>
            <h3 style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
              {t('doc.section_shared')}
              <Badge variant="count">{sharedTotal}</Badge>
            </h3>
            <div className="muted" style={{ fontSize: 'var(--fs-meta)' }}>
              {t('doc.section_shared_hint')}
            </div>
          </div>
        </div>

        {sharedDocs.length === 0
          ? <DocEmpty scope="shared" onOpenAdd={() => setAddDocVis({ defaultVisibility: 'shared' })} />
          : <DocsGrid
              docs={sharedDocs}
              scope="shared"
              members={members}
              profiles={profiles}
              onOpenAdd={() => setAddDocVis({ defaultVisibility: 'shared' })}
              onOpenDetail={setDetailDoc}
            />}
      </section>

      {/* ── Personal section ── */}
      <section style={{ marginBottom: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14 }}>
          <div className="dl-sec-ic dl-sec-ic--mine">
            <Icon name="user" size={17} />
          </div>
          <div>
            <h3 style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
              {t('doc.section_private')}
              <Badge variant="count" style={{ background: 'var(--warm)', color: 'hsl(var(--primary-foreground))' }}>
                {personalTotal}
              </Badge>
            </h3>
            <div className="muted" style={{ fontSize: 'var(--fs-meta)' }}>
              {t('doc.section_private_hint')}
            </div>
          </div>
        </div>

        {personalDocs.length === 0
          ? <DocEmpty scope="personal" onOpenAdd={() => setAddDocVis({ defaultVisibility: 'private' })} />
          : <DocsGrid
              docs={personalDocs}
              scope="personal"
              members={members}
              profiles={profiles}
              onOpenAdd={() => setAddDocVis({ defaultVisibility: 'private' })}
              onOpenDetail={setDetailDoc}
            />}
      </section>

      {/* Dialogs */}
      {addDocVis !== null && (
        <AddDocDialog
          open={true}
          onOpenChange={o => { if (!o) setAddDocVis(null); }}
          tripId={tripId}
          defaultVisibility={addDocVis.defaultVisibility}
        />
      )}
      {detailDoc && (
        <DocDetailDialog
          open={true}
          onOpenChange={o => { if (!o) setDetailDoc(null); }}
          doc={detailDoc}
          tripId={tripId}
        />
      )}
    </div>
  );
}
