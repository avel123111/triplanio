import React, { useRef, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { TRIP_BUCKET, SIGNED_URL_TTL, tripStoragePath } from '@/lib/storage';
import { removeTripFiles } from '@/lib/storageCleanup';
import { Paperclip, Upload, X, Loader2, Plus } from 'lucide-react';
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
  accept = '*',
  maxFileSizeMb = 10,
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
    const oversize = toUpload.find(f => f.size > maxFileSizeMb * 1024 * 1024);
    if (oversize) {
      toast({
        title: t('doc.file_too_big_title'),
        description: t('doc.max_size', { mb: maxFileSizeMb }),
        variant: 'destructive',
      });
      return;
    }
    setUploadingWithCb(true);
    try {
      const uploaded = [];
      for (const file of toUpload) {
        const path = tripStoragePath(tripId, file.name);
        const { error: upErr } = await supabase.storage.from(TRIP_BUCKET).upload(path, file);
        if (upErr) {
          toast({ title: t('event.ai_upload_error'), description: upErr.message, variant: 'destructive' });
          continue;
        }
        // Long-lived signed URL (10 years) - matches the documents lens convention.
        const { data: urlData } = await supabase.storage.from(TRIP_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
        uploaded.push({ file_url: urlData?.signedUrl || '', file_name: file.name, storage_path: path });
        stagedPaths.current.add(path);
      }
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
            <Paperclip className="ico" size={16} style={{ color: iconColor }} />
            <span className="docfield__name">{label || t('event.documents')}</span>
            {docs.length > 0 && (
              <span className="docfield__count">· {docs.length}</span>
            )}
          </div>
        </div>
      )}

      {docs.length > 0 && (
        <div className="docfield__list">
          {docs.map((d, i) => (
            <div key={`${d.file_url}-${i}`} className="docrow">
              <span className="di"><Paperclip size={16} /></span>
              <b style={{ flex: 1, minWidth: 0 }}>
                <a
                  href={d.file_url}
                  target="_blank"
                  rel="noreferrer"
                  className="docrow__link"
                  style={{ color: 'inherit', textDecoration: 'none' }}
                >
                  {d.file_name || t('event.file_word')}
                </a>
              </b>
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="docrow__rm"
                style={{ width: 24, height: 24, borderRadius: 6, color: 'var(--muted)' }}
                aria-label={t('doc.remove_doc_aria')}
              >
                <X size={16} />
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
          className="upload"
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            className="docfield__file"
            accept={accept}
            onChange={(e) => uploadFiles(e.target.files)}
          />
          {uploading ? (
            <>
              <Loader2 className="spin" style={{ color: 'var(--primary)' }} />
              <b>{t('common.loading')}</b>
            </>
          ) : docs.length === 0 ? (
            <>
              <Upload />
              <b>{t('doc.upload_files', { mb: maxFileSizeMb })}</b>
            </>
          ) : (
            <>
              <Plus />
              <b>{t('doc.add_more_files')}{maxFiles ? t('doc.remaining', { n: maxFiles - docs.length }) : ''}</b>
            </>
          )}
        </div>
      )}
    </section>
  );
}