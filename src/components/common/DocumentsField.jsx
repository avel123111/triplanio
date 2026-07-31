import React, { useRef, useState } from 'react';
import { removeTripFiles } from '@/lib/storageCleanup';
import { uploadTripFiles, uploadErrorText, MAX_UPLOAD_MB } from '@/lib/documentMutations';
import { Icon } from '@/design/icons';
import { fileType, UPLOAD_ACCEPT } from '@/lib/fileType';
import { normalizeExternalUrl } from '@/lib/booking-platforms';
import { useToast } from '@/design/index';
import { useT } from '@/lib/i18n/I18nContext';
import './DocumentsField.css';

/**
 * Multi-file document field. Manages an array of { file_url, file_name }.
 * - `value` and `onChange` work with an array.
 * - `maxFiles` (optional): caps the count (no cap by default).
 * - `label`: section title (optional).
 * - `iconColor`: CSS color (token/value) for the section icon.
 */
export default function DocumentsField({
  value = [],
  onChange,
  onUploadingChange,
  tripId,
  maxFiles = null,
  label = '',
  iconColor = 'var(--brand)',
  accept = UPLOAD_ACCEPT,
  bare = false,
}) {
  const { toast } = useToast();
  const t = useT();
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  // storage_paths uploaded during THIS mount (not yet persisted by the parent
  // form). Removing one of these = removing an orphan, so it's safe to delete
  // the Storage object immediately. Files that arrived via `value` (already
  // saved on the entity) are left for the parent's save-time diff (TRIP-117).
  const stagedPaths = useRef(new Set());

  const setUploadingWithCb = (val) => {
    setUploading(val);
    onUploadingChange?.(val);
  };

  const docs = Array.isArray(value) ? value : [];
  const canAddMore = maxFiles === null || docs.length < maxFiles;

  const uploadFiles = async (files) => {
    if (!files?.length) return;
    const remaining = maxFiles === null ? files.length : Math.max(0, maxFiles - docs.length);
    const toUpload = Array.from(files).slice(0, remaining);
    if (toUpload.length === 0) return;
    setUploadingWithCb(true);
    try {
      const { uploaded, errors } = await uploadTripFiles(tripId, toUpload);
      for (const e of errors) {
        toast({
          title: t('event.ai_upload_error'),
          description: uploadErrorText(e, t),
          variant: 'destructive',
        });
      }
      for (const u of uploaded) stagedPaths.current.add(u.storage_path);
      if (uploaded.length) onChange([...docs, ...uploaded]);
    } finally {
      setUploadingWithCb(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const removeAt = (idx) => {
    const removed = docs[idx];
    const next = docs.slice();
    next.splice(idx, 1);
    onChange(next);
    // Only sweep files staged this session — a previously-saved file is still
    // referenced by the entity until the form is saved, so its removal is
    // resolved by the parent's save-time diff (TRIP-117).
    const path = removed?.storage_path;
    if (path && stagedPaths.current.has(path)) {
      stagedPaths.current.delete(path);
      removeTripFiles([path]);
    }
  };

  return (
    <section className={bare ? '' : 'docfield'}>
      {!bare && (
        <div className="docfield__head">
          <div className="docfield__title">
            <Icon name="paperclip" size={16} className="ico" style={{ color: iconColor }} />
            <span className="docfield__name">{label || t('event.documents')}</span>
            {docs.length > 0 && (
              <span className="docfield__count">· {docs.length}</span>
            )}
          </div>
        </div>
      )}

      {docs.length > 0 && (
        <div className="dl-uplist">
          {docs.map((d, i) => (
            <div key={`${d.file_url}-${i}`} className="dl-upitem">
              <span className={`dl-ftag dl-ftag--${fileType(d.file_name)}`}>
                <Icon name="file" size={14} />
              </span>
              <a
                href={normalizeExternalUrl(d.file_url)}
                target="_blank"
                rel="noreferrer"
                className="dl-upitem__n"
                style={{ color: 'var(--brand)' }}
              >
                {d.file_name || t('event.file_word')}
              </a>
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="dl-upitem__rm"
                aria-label={t('doc.remove_doc_aria')}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {canAddMore && (
        <div
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); uploadFiles(e.dataTransfer.files); }}
          className={`dl-dropzone${uploading ? ' is-uploading' : ''}`}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={accept}
            style={{ display: 'none' }}
            onChange={(e) => uploadFiles(e.target.files)}
          />
          {uploading ? (
            <div className="t-body" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brand)' }}>
              <span className="dl-spinner" />
              {t('common.loading')}
            </div>
          ) : (
            <>
              <Icon name="upload" size={24} />
              <b>{docs.length === 0
                ? t('doc.upload_label')
                : `${t('doc.add_more_files')}${maxFiles ? t('doc.remaining', { n: maxFiles - docs.length }) : ''}`}</b>
              <span>{t('doc.upload_formats', { mb: MAX_UPLOAD_MB })}</span>
            </>
          )}
        </div>
      )}
    </section>
  );
}