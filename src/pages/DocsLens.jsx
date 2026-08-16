// @ts-check
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
import { invokeGetTripDetails } from '@/lib/invokeTripFn';
import { TRIP_DOCUMENTS_INCLUDE } from '@/lib/trip-data';
import { collectDocPaths, removeTripFiles } from '@/lib/storageCleanup';
import { uploadTripFiles, uploadErrorText, insertTripDocument, deleteTripDocument, DOCS_KEY, MAX_UPLOAD_MB } from '@/lib/documentMutations';
import { errorText } from '@/lib/errorText';
import { fileType, UPLOAD_ACCEPT } from '@/lib/fileType';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/AuthContext';
import { Icon } from '../design/icons';
import { Avatar, Badge, Btn, Card, IconBtn, Field, Input, Textarea, Severity, Skeleton, Seg, Tile, DialogRoot as Dialog, DialogContent, DialogTitle, useToast, FileRow } from '../design/index';
import { Row, Col, Grid, Trunc, Grow } from '../design/Layout';
import { resolveAuthor } from '@/lib/resolveAuthor';
import { displayName } from '@/lib/displayName';
import { useIsMobile } from '@/hooks/use-mobile';
import { useI18n } from '@/lib/i18n/I18nContext';
import { successToast } from '@/lib/successToast';
import { useConfirm } from '@/components/common/ConfirmProvider';
import { FieldError, IssuesPanel, fieldState, useHybridValidation } from '@/components/common/ValidationUI';
import { normalizeExternalUrl } from '@/lib/booking-platforms';
import './DocsLens.css';

// ─── query key (DOCS_KEY) is owned by the document data-access layer ──────────

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Inline file chip used in both cards and the detail dialog. */
function FileChip({ file }) {
  return <FileRow name={file.file_name} />;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── AddDocDialog ─────────────────────────────────────────────────────────────

export function AddDocDialog({ tripId, defaultVisibility = 'shared', open, onOpenChange }) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  // Files are uploaded to Storage as they're picked, before the row is saved.
  // If the dialog is dismissed without saving, those staged objects are orphaned
  // (the component unmounts on close, so `documents` only ever holds this
  // session's staged uploads). Sweep them on any close path unless we saved.
  const savedRef = useRef(false);
  const handleOpenChange = (next) => {
    if (!next && !savedRef.current) removeTripFiles(collectDocPaths(documents));
    onOpenChange?.(next);
  };
  const close = () => handleOpenChange(false);

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
  const st   = (f) => fieldState(v.displayIssues, f);

  async function uploadFiles(files) {
    if (!files?.length) return;
    setUploading(true); setErr('');
    try {
      const { uploaded, errors } = await uploadTripFiles(tripId, files);
      for (const e of errors) setErr(uploadErrorText(e, t));
      if (uploaded.length) setDocuments(prev => [...prev, ...uploaded]);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function save() {
    setSaving(true); setErr('');
    try {
      await insertTripDocument({
        tripId,
        title:      title.trim(),
        notes:      notes.trim()   || null,
        // Store an ABSOLUTE url: a scheme-less "google.com" is a relative path
        // to the browser and would navigate inside the app (TRIP-230).
        link_url:   normalizeExternalUrl(linkUrl),
        documents:  documents.length ? documents : null,
        visibility,
        // `created_by` is stamped by the server from the JWT (TRIP-399) — not sent.
        // Author-name snapshot — mirrors chat_messages.user_full_name so the
        // uploader's name survives them leaving the trip (their trip_members /
        // active-profile row is gone). resolveAuthor() reads this as the fallback.
        created_by_name: (user?.full_name || '').trim() || null,
      });
    } catch (e) {
      setSaving(false);
      // insertTripDocument бросает refusalError → текст по машинному `code`
      // (серверную прозу не показываем, TRIP-378/423).
      setErr(errorText(t, e?.code));
      return;
    }
    setSaving(false);
    // Saved → the staged files are now referenced by the row; the close sweep
    // must skip them.
    savedRef.current = true;
    // One event split by PROPERTIES (TRIP-316). Shared vs private used to be two
    // events, document1_/document2_uploaded, whose digits mean nothing to anyone
    // reading the report. `file_kind` reuses the badge classifier, so "what do
    // people actually keep here - scans or PDF bookings?" becomes answerable:
    // there is no document TYPE (passport / insurance) anywhere in the model,
    // the extension is all we know. Mixed kinds collapse to 'mixed', and no files
    // at all (a link or a bare note) to 'none'.
    const kinds = [...new Set(documents.map((d) => fileType(d.file_name)))];
    track('document_uploaded', {
      trip_id: tripId,
      visibility,
      file_kind: kinds.length > 1 ? 'mixed' : (kinds[0] || 'none'),
      has_link: !!linkUrl.trim(),
    });
    qc.invalidateQueries({ queryKey: DOCS_KEY(tripId) });
    successToast(t, 'document_saved');
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent aria-describedby={undefined}>
        {/* sr-only a11y title — visible h2 is inside dlg__head */}
        <DialogTitle className="sr-only">{t('doc.dialog_new')}</DialogTitle>

        {/* ── Header ── */}
        <div className="dlg__head">
          <Tile as="span" style={{ '--tile': '36px' }}>
            <Icon name="file" size={17} />
          </Tile>
          <h2>{t('doc.dialog_new')}</h2>
          <IconBtn icon="close" onClick={close} ariaLabel={t('common.close')} />
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
            <Row gap="g3" className="dl-label">{t('doc.access_label')}</Row>
            <Grid cols="2">
              {visOpts.map(opt => (
                // Поведение + ВЫБОР (aria-selected) на обёртке role=button;
                // скин утоплённой поверхности + интерактив — на дочернем Card,
                // канон читает выбор дочерним комбинатором (эталон pcard,
                // TRIP-343 объект 2, fork 2).
                <div
                  key={opt.value}
                  role="button"
                  tabIndex={0}
                  data-card-btn=""
                  aria-selected={visibility === opt.value || undefined}
                  onClick={() => setVisibility(opt.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setVisibility(opt.value); } }}>
                  <Card as="div" recessed interactive radius="md"
                    className={`row dl-visopt${opt.value === 'private' ? ' dl-visopt--mine' : ''}`}>
                    <Tile as="span" icon={opt.icon} />
                    <span className="dl-visopt__lbl">
                      <b>{opt.label}</b>
                      <span>{opt.desc}</span>
                    </span>
                  </Card>
                </div>
              ))}
            </Grid>
          </div>

          {/* Title */}
          <Field label={t('trip.title_label')} required={v.isRequired('title')}>
            <div data-vfield="title">
              <Input
                {...st('title')}
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
              <Textarea
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
                type="url"
                inputMode="url"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                placeholder={t('doc.link_placeholder')}
              />
            </Field>
          </div>

          {/* Files */}
          <div style={{ marginTop: 16 }}>
            <Row gap="g3" className="dl-label">
              <Icon name="paperclip" size={13} style={{ color: 'var(--brand)' }} />
              {t('doc.files_label')}
              {documents.length > 0 && (
                <span className="muted t-body" style={{ marginLeft: 4 }}>
                  · {documents.length}
                </span>
              )}
            </Row>

            {/* Uploaded files list */}
            {documents.length > 0 && (
              <Col gap="g3" className="dl-uplist">
                {documents.map((d, i) => (
                  <FileRow
                    key={i}
                    name={d.file_name}
                    action={(
                      <IconBtn
                        icon="close"
                        tone="danger"
                        size="sm"
                        ariaLabel={t('doc.remove_doc_aria')}
                        onClick={() => {
                          // Staged-but-unsaved upload → the object is already
                          // orphaned, remove it immediately (TRIP-117).
                          removeTripFiles(collectDocPaths([documents[i]]));
                          setDocuments(prev => prev.filter((_, j) => j !== i));
                        }}
                      />
                    )}
                  />
                ))}
              </Col>
            )}

            {/* Drop zone — поведение (клик/drag) вокруг Card, скин на канон add
                (Pavel: Card владеет скином, поведение композится вокруг). */}
            <div
              onClick={() => !uploading && fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); uploadFiles(e.dataTransfer.files); }}>
              <Card variant="add" radius="md" className={`col col--g3 dl-dropzone${uploading ? ' is-uploading' : ''}`}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={UPLOAD_ACCEPT}
                  style={{ display: 'none' }}
                  onChange={e => uploadFiles(e.target.files)}
                />
                {uploading ? (
                  <Row gap="g4" className="t-body">
                    <span className="spin spin--ring" />
                    {t('common.loading')}
                  </Row>
                ) : (
                  <>
                    <Icon name="upload" size={24} />
                    <b>{documents.length === 0 ? t('doc.upload_label') : t('doc.add_more_files')}</b>
                    <span>{t('doc.upload_formats', { mb: MAX_UPLOAD_MB })}</span>
                  </>
                )}
              </Card>
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="dlg__foot">
          <Btn variant="secondary" onClick={close}>{t('trip.form_cancel')}</Btn>
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

function DocDetailDialog({ doc, tripId, open, onOpenChange, readOnly }) {
  const { t }    = useI18n();
  const close    = () => onOpenChange?.(false);
  const confirm  = useConfirm();
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  async function handleDelete() {
    if (!(await confirm({ title: t('doc.delete_confirm', { name: doc.title }), variant: 'destructive' }))) return;
    setDeleting(true);
    let deleted;
    try {
      deleted = await deleteTripDocument(tripId, doc.id); // false = already gone (404), not success
    } catch (e) {
      setDeleting(false);
      // Реальный отказ (напр. DOC_PRIVATE_NOT_OWNER) → текст по машинному `code`.
      toast({ description: errorText(t, e?.code), variant: 'destructive' });
      return; // real error → keep dialog open
    }
    if (!deleted) {
      // Nothing was deleted: RLS hid the row (session expired / removed from
      // trip) or another member already deleted it. Don't sweep files, don't
      // claim success — refresh so the user sees the real state. Контракт
      // deleteTripDocument: false = NOT_FOUND → так и словим.
      setDeleting(false);
      qc.invalidateQueries({ queryKey: DOCS_KEY(tripId) });
      toast({ description: errorText(t, 'NOT_FOUND'), variant: 'destructive' });
      return;
    }
    // Row gone → its files are now orphaned (unique uuid keys, single reference).
    // Best-effort sweep; never blocks the delete (TRIP-117).
    await removeTripFiles(collectDocPaths(doc.documents));
    qc.invalidateQueries({ queryKey: DOCS_KEY(tripId) });
    successToast(t, 'document_deleted');
    close();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle className="sr-only">{doc.title}</DialogTitle>

        {/* ── Header ── */}
        <div className="dlg__head">
          <Tile as="span" style={{ '--tile': '36px' }}>
            <Icon name="file" size={17} />
          </Tile>
          <h2>{doc.title}</h2>
          <IconBtn icon="close" onClick={close} ariaLabel={t('common.close')} />
        </div>

        {/* ── Body ── */}
        <div className="dlg__body">
          {doc.notes && (
            <p className="dl-dview-note">{doc.notes}</p>
          )}

          {/* href is normalized on save, but rows stored before TRIP-230 still
              hold a bare "google.com" — keep the read side safe for them too. */}
          {doc.link_url && (
            <a className="row dl-dview-link" href={normalizeExternalUrl(doc.link_url)} target="_blank" rel="noreferrer">
              <Icon name="external" size={16} />
              <b>{doc.link_url}</b>
            </a>
          )}

          {doc.documents?.length > 0 && (
            <div>
              <Row gap="g3" className="dl-label" style={{ marginTop: doc.notes || doc.link_url ? 14 : 0 }}>
                <Icon name="paperclip" size={13} style={{ color: 'var(--brand)' }} />
                {t('doc.files_label')}
              </Row>
              <Col gap="g3">
                {doc.documents.map((f, i) => (
                  <FileRow key={i} name={f.file_name} fallback={f.file_url} href={normalizeExternalUrl(f.file_url)} />
                ))}
              </Col>
            </div>
          )}

          {!doc.notes && !doc.link_url && !doc.documents?.length && (
            <div className="muted t-body">
              {t('doc.no_content')}
            </div>
          )}

          {doc.created_at && (
            <Row gap="g4" className="dl-dview-meta">
              <Icon name="calendar" size={13} />
              {formatDate(doc.created_at)}
            </Row>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="dlg__foot">
          {!readOnly && (
            <Btn variant="danger" loading={deleting} icon="trash" onClick={handleDelete}>
              {t('trip.delete')}
            </Btn>
          )}
          <Grow />
          <Btn variant="secondary" onClick={close}>{t('common.close')}</Btn>
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
    <Card
      as="button"
      radius="md"
      interactive
      className="col dl-card"
      onClick={() => onOpenDetail?.(doc)}>

      {/* Icon + title + visibility chip */}
      <Row align="a-start" className="dl-card__top">
        <Tile size="lg" icon="file" className={isShared ? undefined : 'dl-card__ic--mine'} />
        <div className="dl-card__h">
          <Trunc className="dl-card__title">{doc.title}</Trunc>
          <div className="dl-card__sub">
            {files.length > 0
              ? `${files.length} ${files.length === 1 ? t('doc.files_count_one') : t('doc.files_count_few')}`
              : t('doc.card_no_files')}
            {doc.link_url && t('doc.has_link')}
          </div>
        </div>
        <Row as="span" inline gap="g2" className={`dl-vischip${isShared ? '' : ' dl-vischip--mine'}`}>
          <Icon name={isShared ? 'users' : 'lock'} size={11} />
        </Row>
      </Row>

      {/* Notes excerpt */}
      {doc.notes && (
        <div className="dl-card__notes">{doc.notes}</div>
      )}

      {/* File chips (max 2) */}
      {shown.length > 0 && (
        <Col gap="g3">
          {shown.map((f, i) => <FileChip key={i} file={f} />)}
          {more > 0 && (
            <span className="dl-filemore">+{more} {t('doc.files_count_few')}</span>
          )}
        </Col>
      )}

      {/* Link row (visual, non-navigating — detail dialog has the real link) */}
      {doc.link_url && (
        <Row className="dl-linkrow">
          <Icon name="external" size={14} />
          <b>{doc.link_url.replace(/^https?:\/\//, '').split('/')[0]}</b>
          <Icon name="chev" size={13} style={{ opacity: .55 }} />
        </Row>
      )}

      {/* Footer: avatar + name + date */}
      <Row className="dl-card__foot">
        {isShared ? (
          <>
            <Avatar name={uploader.name} photo={uploader.photo} deleted={uploader.deleted} size="sm" />
            <Grow as="span" fit className="trunc dl-card__foot-who">{uploader.name}</Grow>
          </>
        ) : (
          <>
            <Avatar name={displayName(user?.email, user?.full_name)} size="sm" />
            <Grow as="span" fit className="trunc dl-card__foot-who">{t('doc.only_you')}</Grow>
          </>
        )}
        <span className="dl-card__foot-date">{formatDate(doc.created_at)}</span>
      </Row>
    </Card>
  );
}

// ─── DocEmpty ─────────────────────────────────────────────────────────────────

function DocEmpty({ scope, onOpenAdd, canAdd = true }) {
  const { t }    = useI18n();
  const isShared = scope !== 'personal';
  return (
    // Скин утоплённой поверхности — канон `<Card recessed>` (TRIP-343 объект 2).
    <Card recessed radius="md" className="dl-empty">
      <Tile size="2xl" icon="file" className={`dl-empty__ic${isShared ? '' : ' dl-empty__ic--mine'}`} />
      <b>{isShared ? t('doc.empty_shared') : t('doc.empty_private')}</b>
      <span>{isShared ? t('doc.empty_shared_desc') : t('doc.empty_private_desc')}</span>
      {canAdd && (
        <Btn
          variant="soft"
          icon="plus"
          /* Личные доки = тёплый тон. Ведём его ВХОДОМ канала (--hl-soft/--hl-ink),
             а не инлайном итоговых background/color: так `.btn--soft` держит свой
             ховер, а не глохнет под перекрытием заливки (TRIP-344). */
          style={!isShared ? { '--hl-soft': 'var(--warm-soft)', '--hl-ink': 'var(--warm-ink)' } : undefined}
          onClick={() => onOpenAdd?.()}>
          {t('doc.add_doc')}
        </Btn>
      )}
    </Card>
  );
}

// ─── DocsGrid ─────────────────────────────────────────────────────────────────

function DocsGrid({ docs, scope, members, profiles, onOpenAdd, onOpenDetail, canAdd = true }) {
  const { t }    = useI18n();
  const isShared = scope !== 'personal';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
      {docs.map(d => (
        <DocCard key={d.id} doc={d} scope={scope} members={members} profiles={profiles} onOpenDetail={onOpenDetail} />
      ))}
      {canAdd && (
        <Card as="button" variant="add" radius="md"
          className={`col col--g4 col--j-center dl-addcard${!isShared ? ' dl-addcard--mine' : ''}`}
          onClick={() => onOpenAdd?.()}>
          <Tile as="span" size="xl" tone="quiet" icon="plus" className="dl-addcard__ic" />
          <b>{t('doc.add_doc')}</b>
        </Card>
      )}
    </div>
  );
}

// ─── DocsLens (main export) ───────────────────────────────────────────────────

export default function DocsLens({ tripId, isLoading: parentLoading, members = [], canEdit = false, profiles = {} }) {
  const { t }    = useI18n();
  const { user } = useAuth();
  // Право редактировать — единая лестница доступа (ступень editor), решено выше
  // в TripView. Read-only = не editor; серверная защита — edge/RLS _can_edit_trip.
  const readOnly = !canEdit;
  const [addDocVis,    setAddDocVis]    = useState(null); // null | { defaultVisibility }
  const [detailDoc,    setDetailDoc]    = useState(null); // null | doc object
  const [searchQuery,  setSearchQuery]  = useState('');
  const [filter,       setFilter]       = useState('all'); // 'all' | 'files' | 'links'

  const { data: docs = [], isLoading, error } = useQuery({
    queryKey: DOCS_KEY(tripId),
    queryFn: async () => {
      // Read через единую дверь чтения (TRIP-399, §6): getTripDetails УЖЕ фильтрует
      // под service_role `shared → всем, private → только автору` (правило
      // `_can_access_trip_document`), поэтому прямого `.from('trip_documents')`
      // здесь больше нет — только после его снятия шаг C сможет отозвать SELECT.
      const data = await invokeGetTripDetails({ tripId, include: TRIP_DOCUMENTS_INCLUDE });
      // getTripDetails не сортирует documents; список показываем новыми сверху.
      return (data?.documents || []).slice().sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
    },
    enabled: !!tripId,
  });

  // Author identity (name/avatar/is_deleted) comes from the ONE profile bundle
  // shipped with the trip content (getTripDetails), handed down by TripView —
  // no separate profile-fetch hop. Authors who have LEFT the trip aren't in
  // the bundle; resolveAuthor falls back to the doc's created_by_name snapshot.

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
        <Skeleton w="100%" h={44} r={'var(--r-xl)'} />
        <Skeleton w="100%" h={180} r={'var(--r-sm)'} />
        <Skeleton w="100%" h={180} r={'var(--r-sm)'} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32 }}>
        <Severity level="error">{errorText(t, error && 'code' in error && typeof error.code === 'string' ? error.code : null)}</Severity>
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
      {readOnly && (
        <Severity level="info" title={t('settings.readonly_banner_title')}>{t('doc.readonly_banner_desc')}</Severity>
      )}
      {/* ── Toolbar: search + filter ── */}
      <Row wrap gap="g6" className="dl-toolbar">
        <Input
          className="dl-search"
          icon="search"
          type="search"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder={t('doc.search_ph')}
          aria-label={t('doc.search_ph')}
        />
        <Seg
          ariaLabel={t('doc.filter_label')}
          value={filter}
          onChange={setFilter}
          options={filterOpts.map(opt => ({ value: opt.key, label: opt.label }))}
        />
      </Row>

      {/* ── Shared section ── */}
      <section style={{ marginBottom: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14 }}>
          <Tile icon="users" />
          <div>
            <h3 style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
              {t('doc.section_shared')}
              <Badge variant="count">{sharedTotal}</Badge>
            </h3>
            <div className="muted t-meta">
              {t('doc.section_shared_hint')}
            </div>
          </div>
        </div>

        {sharedDocs.length === 0
          ? <DocEmpty scope="shared" canAdd={!readOnly} onOpenAdd={() => setAddDocVis({ defaultVisibility: 'shared' })} />
          : <DocsGrid
              docs={sharedDocs}
              scope="shared"
              members={members}
              profiles={profiles}
              canAdd={!readOnly}
              onOpenAdd={() => setAddDocVis({ defaultVisibility: 'shared' })}
              onOpenDetail={setDetailDoc}
            />}
      </section>

      {/* ── Personal section ── */}
      <section style={{ marginBottom: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 14 }}>
          <Tile icon="user" className="dl-sec-ic--mine" />
          <div>
            <h3 style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
              {t('doc.section_private')}
              <Badge variant="count" style={{ background: 'var(--warm)', color: 'var(--primary-fg)' }}>
                {personalTotal}
              </Badge>
            </h3>
            <div className="muted t-meta">
              {t('doc.section_private_hint')}
            </div>
          </div>
        </div>

        {personalDocs.length === 0
          ? <DocEmpty scope="personal" canAdd={!readOnly} onOpenAdd={() => setAddDocVis({ defaultVisibility: 'private' })} />
          : <DocsGrid
              docs={personalDocs}
              scope="personal"
              members={members}
              profiles={profiles}
              canAdd={!readOnly}
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
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
