import React, { useRef, useState } from 'react';
import { Upload, Loader2, Check } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { TRIP_BUCKET, SIGNED_URL_TTL, DRAFT_PREFIX, tripStoragePath } from '@/lib/storage';
import { collectDocPaths, removeTripFiles } from '@/lib/storageCleanup';
import { TRIP_GRADIENTS, getGradientById } from '@/lib/trip-gradients';
import { useT } from '@/lib/i18n/I18nContext';
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
      removeTripFiles(collectDocPaths([], url));
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
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(t('trip.cover_too_large'));
      return;
    }
    setError('');
    setUploading(true);
    try {
      // Before the trip exists, park the file under `_drafts/`; finalizeDraftCover
      // moves it under `<tripId>/` on trip creation. The bucket is private, so the
      // cover is served via a long-lived signed URL (not a public URL).
      const path = tripStoragePath(tripId || DRAFT_PREFIX, file.name);
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
    <div className="tcp">
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
        {TRIP_GRADIENTS.map((g) => {
          const active = !coverImageUrl && coverGradient === g.id;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => handlePickGradient(g.id)}
              title={g.name}
              className={`tcp__sw${active ? ' is-active' : ''}`}
              style={{ background: g.preview }}
            >
              {active && <Check className="tcp__check" size={16} />}
            </button>
          );
        })}

        <button
          type="button"
          onClick={handlePickFile}
          disabled={uploading}
          className="tcp__upload"
        >
          {uploading ? (
            <Loader2 className="spin" size={14} />
          ) : (
            <Upload size={14} />
          )}
          {uploading ? t('trip.form_uploading') : t('trip.form_upload_image')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={handleUpload}
          className="tcp__file"
        />
      </div>

      {error && <p className="tcp__err">{error}</p>}
    </div>
  );
}
