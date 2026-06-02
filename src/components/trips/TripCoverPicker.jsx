import React, { useRef, useState } from 'react';
import { Upload, Loader2, Check } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { safeStorageName } from '@/lib/storage';
import { TRIP_GRADIENTS, getGradientById } from '@/lib/trip-gradients';
import { useT } from '@/lib/i18n/I18nContext';

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB
const BUCKET = 'trip-covers';

/**
 * Cover picker shared by TripFormDialog and the AI create wizard. Lets the
 * user pick one of 8 preset gradients or upload a photo to Supabase Storage.
 * Calls `onChange({ cover_image_url, cover_gradient })` with the new pair -  * choosing a gradient clears the uploaded photo and vice versa.
 */
export default function TripCoverPicker({
  coverImageUrl = '',
  coverGradient = '',
  tripId,
  onChange,
}) {
  const t = useT();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const gradient = getGradientById(coverGradient);

  const handlePickGradient = (id) => {
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
      const path = `${tripId || 'new'}/${Date.now()}_${safeStorageName(file.name)}`;
      const { data, error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { cacheControl: '3600', upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
      onChange({ cover_image_url: pub.publicUrl, cover_gradient: '' });
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
    <div className="space-y-3">
      <div
        className="relative w-full h-[120px] rounded-lg overflow-hidden border bg-muted"
        style={previewStyle}
      >
        {coverImageUrl ? (
          <img src={coverImageUrl} alt="" className="w-full h-full object-cover" />
        ) : !gradient ? (
          <div className="w-full h-full flex items-center justify-center text-3xl opacity-30">
            🌍
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TRIP_GRADIENTS.map((g) => {
          const active = !coverImageUrl && coverGradient === g.id;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => handlePickGradient(g.id)}
              title={g.name}
              className={`relative w-10 h-10 rounded-full transition-transform ${
                active ? 'ring-2 ring-white ring-offset-2 ring-offset-background scale-110' : 'hover:scale-105'
              }`}
              style={{ background: g.preview }}
            >
              {active && (
                <Check className="absolute inset-0 m-auto w-4 h-4 text-white drop-shadow" />
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={handlePickFile}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border bg-background hover:bg-secondary text-sm disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Upload className="w-3.5 h-3.5" />
          )}
          {uploading ? t('trip.form_uploading') : t('trip.form_upload_image')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={handleUpload}
          className="hidden"
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
