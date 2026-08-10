import React, { useRef, useState } from 'react';
import { Btn, Swatch } from '@/design/index';
import { supabase } from '@/api/supabaseClient';
import { TRIP_BUCKET, SIGNED_URL_TTL, tripStoragePath, draftStoragePath } from '@/lib/storage';
import { collectDocPaths, removeTripFiles } from '@/lib/storageCleanup';
import { TRIP_GRADIENTS, getGradientById } from '@/lib/trip-gradients';
import { isAllowedUpload, ALLOWED_IMAGE_EXTENSIONS, IMAGE_ACCEPT } from '@/lib/fileType';
import { useT } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import './TripCoverPicker.css';

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB

/**
 * Cover picker shared by the create flow (ManualPlanner) and trip Settings
 * (SettingsLens). Lets the user pick one of the built-in gradients
 * (TRIP_GRADIENTS) or upload a photo to Supabase Storage. Calls
 * `onChange({ cover_image_url, cover_gradient })` with the new pair — choosing a
 * gradient clears the uploaded photo and vice versa.
 */
export default function TripCoverPicker({
  coverImageUrl = '',
  coverGradient = '',
  tripId,
  onChange,
  showPreview = true,
}) {
  const t = useT();
  const { user } = useAuth();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  // Covers uploaded during THIS picker session. When such a staged cover is
  // replaced (new upload / gradient) it's an orphan → delete it immediately.
  // A cover that arrived via props is the persisted one; its replacement is
  // swept by the parent's save-time diff, not here (TRIP-117).
  const stagedUrls = useRef(new Set());
  const sweepIfStaged = (url) => {
    if (url && stagedUrls.current.has(url)) {
      stagedUrls.current.delete(url);
      removeTripFiles(collectDocPaths([{ file_url: url }]));
    }
  };

  const gradient = getGradientById(coverGradient);

  const handlePickGradient = (id) => {
    sweepIfStaged(coverImageUrl);
    onChange({ cover_image_url: '', cover_gradient: id });
  };

  const handlePickFile = () => fileRef.current?.click();

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isAllowedUpload(file, ALLOWED_IMAGE_EXTENSIONS)) {
      setError(t('doc.bad_format', { name: file.name }));
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(t('trip.cover_too_large'));
      return;
    }
    // A draft cover is keyed by its uploader, so without a session there is no
    // folder RLS would let us write to.
    if (!tripId && !user?.id) {
      setError(t('trip.cover_upload_failed'));
      return;
    }
    setError('');
    setUploading(true);
    try {
      // Before the trip exists, park the file in the uploader's own draft folder
      // (`_drafts/<userId>/…`, the only one RLS lets them touch); finalizeDraftCover
      // moves it under `<tripId>/` on trip creation. The bucket is private, so the
      // cover is served via a long-lived signed URL (not a public URL).
      const path = tripId
        ? tripStoragePath(tripId, file.name)
        : draftStoragePath(user.id, file.name);
      const { error: uploadErr } = await supabase.storage
        .from(TRIP_BUCKET)
        .upload(path, file, { cacheControl: '3600', upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: signed, error: signErr } = await supabase.storage
        .from(TRIP_BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL);
      if (signErr || !signed?.signedUrl) throw signErr || new Error(t('trip.cover_upload_failed'));
      sweepIfStaged(coverImageUrl); // replacing an earlier staged upload
      stagedUrls.current.add(signed.signedUrl);
      onChange({ cover_image_url: signed.signedUrl, cover_gradient: '' });
    } catch (err) {
      setError(err?.message || t('trip.cover_upload_failed'));
    } finally {
      setUploading(false);
    }
  };

  const previewStyle = coverImageUrl
    ? undefined
    : gradient
      ? { background: gradient.css }
      : undefined;

  return (
    <div className="col col--g6">
      {showPreview && (
        <div className="tcp__preview" style={previewStyle}>
          {coverImageUrl ? (
            <img src={coverImageUrl} alt="" className="tcp__img" />
          ) : !gradient ? (
            <div className="tcp__ph">🌍</div>
          ) : null}
        </div>
      )}

      <div className="tcp__swatches">
        {TRIP_GRADIENTS.map((g) => (
          <Swatch
            key={g.id}
            variant="round"
            on={!coverImageUrl && coverGradient === g.id}
            onClick={() => handlePickGradient(g.id)}
            title={g.name}
            style={{ background: g.preview }}
          />
        ))}

        {/* Кнопка загрузки — обычная вторичная кнопка системы. Своего класса
            `.tcp__upload` у неё больше нет: он повторял тон secondary и при
            этом брал радиус со ступени ПОВЕРХНОСТИ (--r-md 16px) вместо ступени
            КОНТРОЛА (--r-btn 10px), из-за чего кнопка была скруглена сильнее
            соседних. Спиннер отдаёт `loading` — он же гасит кнопку и ставит
            aria-busy, поэтому отдельный `disabled` не нужен. */}
        <Btn
          variant="secondary"
          icon="upload"
          loading={uploading}
          onClick={handlePickFile}
        >
          {uploading ? t('trip.form_uploading') : t('trip.form_upload_image')}
        </Btn>
        <input
          ref={fileRef}
          type="file"
          accept={IMAGE_ACCEPT}
          onChange={handleUpload}
          className="tcp__file"
        />
      </div>

      {error && <p className="tcp__err">{error}</p>}
    </div>
  );
}
