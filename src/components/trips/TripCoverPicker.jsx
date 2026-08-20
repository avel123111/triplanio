import React, { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Btn, Card, COVER_FALLBACK, Swatch } from '@/design/index';
import { supabase } from '@/api/supabaseClient';
import { invokeFn } from '@/lib/invokeFn';
import { TRIP_BUCKET, SIGNED_URL_TTL, tripStoragePath, draftStoragePath } from '@/lib/storage';
import { collectDocPaths, removeTripFiles } from '@/lib/storageCleanup';
import { report } from '@/lib/reportDataError';
import { isAllowedUpload, ALLOWED_IMAGE_EXTENSIONS, IMAGE_ACCEPT } from '@/lib/fileType';
import { uploadErrorText } from '@/lib/documentMutations';
import { useT } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import './TripCoverPicker.css';

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB

// Каталог пресетов читаем через edge-витрину getCoverPresets (дверь auth,
// service_role) — прямого клиентского SELECT нет (эпик «единая дверь» TRIP-374).
async function fetchCoverPresets() {
  const { data, error } = await invokeFn('getCoverPresets', { body: {} });
  if (error) throw new Error('getCoverPresets failed');
  return data?.presets || [];
}

/**
 * Cover picker shared by the create flow (ManualPlanner) and trip Settings
 * (SettingsLens). Lets the user pick one of the curated preset images
 * (getCoverPresets) or upload their own photo to Supabase Storage. Both cases
 * write the same field: choosing a preset COPIES its public URL into
 * `cover_image_url` (exactly like an upload), so removing a preset from the
 * gallery never breaks a trip that already picked it. No gradients anymore —
 * an empty cover renders the bundled fallback image.
 * Calls `onChange({ cover_image_url })` with the new value.
 */
export default function TripCoverPicker({
  coverImageUrl = '',
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
  // replaced (new upload / preset) it's an orphan → delete it immediately.
  // A cover that arrived via props is the persisted one; its replacement is
  // swept by the parent's save-time diff, not here (TRIP-117). Preset URLs live
  // in the public `trip-cover-presets` bucket, so sweeping (bucket `trips`)
  // never touches them.
  const stagedUrls = useRef(new Set());
  const sweepIfStaged = (url) => {
    if (url && stagedUrls.current.has(url)) {
      stagedUrls.current.delete(url);
      removeTripFiles(collectDocPaths([{ file_url: url }]));
    }
  };

  const { data: presets = [] } = useQuery({
    queryKey: ['coverPresets'],
    queryFn: fetchCoverPresets,
    // Набор курируется вручную и меняется редко — держим час, чтобы переход
    // между создать/настройки не бил edge заново.
    staleTime: 60 * 60 * 1000,
  });

  const handlePickPreset = (url) => {
    sweepIfStaged(coverImageUrl);
    onChange({ cover_image_url: url });
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
      // storage-report: залив обложки трипа — сбой байтовой двери виден в форме.
      const { error: uploadErr } = await supabase.storage
        .from(TRIP_BUCKET)
        .upload(path, file, { cacheControl: '3600', upsert: true });
      if (uploadErr) { report(uploadErr, { surface: 'storage', source: 'upload_cover' }); throw uploadErr; }
      const { data: signed, error: signErr } = await supabase.storage
        .from(TRIP_BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL);
      if (signErr || !signed?.signedUrl) throw signErr || new Error(t('trip.cover_upload_failed'));
      sweepIfStaged(coverImageUrl); // replacing an earlier staged upload
      stagedUrls.current.add(signed.signedUrl);
      onChange({ cover_image_url: signed.signedUrl });
    } catch (err) {
      // Storage-ошибка (кода НЕТ) → её дом uploadErrorText, не сырой показ .message.
      const storageMsg = err?.message;
      setError(uploadErrorText({ file, reason: 'upload', message: storageMsg }, t));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="col col--g6">
      {showPreview && (
        /* TRIP-343 объект 2 (G): превью обложки — постер-форма <Card pad="none">;
           скин (рамка+радиус+фон) на примитиве, `.tcp__preview` — раскладка.
           Обложки нет → показываем ту же фоллбек-картинку, что увидит трип. */
        <Card pad="none" radius="md" className="tcp__preview">
          <img src={coverImageUrl || COVER_FALLBACK} alt="" className="tcp__img" />
        </Card>
      )}

      <div className="tcp__swatches">
        {presets.map((p) => {
          /* Плитка пресета — примитив <Swatch variant="round"> (его round-вариант и
             ЕСТЬ обложка-свотч, TRIP-344): выбор = aria-pressed, картинка — фоном.
             Выбор пресета копирует его URL в cover_image_url (как аплоад). Фон из
             данных держим переменной (гард 2l не считает `style={var}`), как в
             VisitPanel/TripDot. */
          const swatchStyle = { backgroundImage: `url(${p.image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' };
          return (
            <Swatch
              key={p.id}
              variant="round"
              on={coverImageUrl === p.image_url}
              onClick={() => handlePickPreset(p.image_url)}
              aria-label={t('trip.cover_preset')}
              style={swatchStyle}
            />
          );
        })}

        {/* Кнопка загрузки — обычная вторичная кнопка системы. Спиннер отдаёт
            `loading` — он же гасит кнопку и ставит aria-busy. */}
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
