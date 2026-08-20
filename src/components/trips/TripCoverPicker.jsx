import React, { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Carousel, COVER_FALLBACK, IconBtn, Swatch } from '@/design/index';
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
  // Hero-режим: когда задан heroClassName, вместо маленького превью рисуется
  // большая обложка (фото на всю ширину) с кнопкой загрузки в правом верхнем
  // углу и стрелками смены кавера по бокам; heroOverlay — контент поверх низа
  // обложки (в планнере — <EditableText> с названием трипа). Без heroClassName
  // (Settings, место #2) поведение прежнее: превью-карточка + лента.
  heroClassName = '',
  heroOverlay = null,
}) {
  const t = useT();
  const { user } = useAuth();
  const fileRef = useRef(null);
  const stripRef = useRef(/** @type {HTMLDivElement | null} */ (null));
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

  const handlePickPreset = (url, el) => {
    sweepIfStaged(coverImageUrl);
    onChange({ cover_image_url: url });
    // Довести выбранную миниатюру к центру ленты — активная плитка расширяется
    // (CSS), доводчик держит её в кадре: лента «дышит», а не стоит рядом.
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  };

  // Стрелки НА ОБЛОЖКЕ меняют сам выбранный кавер (prev/next по каталогу), а не
  // скроллят ленту. Текущий кавер может быть загруженным фото/фоллбеком (индекса
  // в каталоге нет) — тогда первый шаг встаёт на край каталога. Лента доводит
  // новую выбранную миниатюру к центру, чтобы стрелка и лента были заодно.
  const cyclePreset = (dir) => {
    if (presets.length === 0) return;
    const cur = presets.findIndex((p) => p.image_url === coverImageUrl);
    const idx = cur === -1
      ? (dir > 0 ? 0 : presets.length - 1)
      : (cur + dir + presets.length) % presets.length;
    const thumb = stripRef.current?.querySelector(`[data-idx="${idx}"]`);
    handlePickPreset(presets[idx].image_url, /** @type {HTMLElement | null} */ (thumb));
  };

  // В hero-режиме (создание трипа) шаг открывается БЕЗ выбранной обложки —
  // плейсхолдер. Как только каталог пресетов загрузился, выбираем первый по
  // умолчанию, чтобы у трипа сразу был кавер (пустой `coverImageUrl` — только
  // до этого момента; свой выбор/аплоад делают его непустым и эффект молчит).
  useEffect(() => {
    if (heroClassName && !coverImageUrl && presets.length > 0) {
      onChange({ cover_image_url: presets[0].image_url });
    }
  }, [heroClassName, coverImageUrl, presets, onChange]);

  // Свайп по самой обложке (мобайл) листает кавер — тот же cyclePreset, что и
  // боковые стрелки. Горизонтальный сдвиг за порог: влево = следующий, вправо =
  // предыдущий. Порог отсекает случайные тапы (по карандашу/кнопкам).
  const touchStartX = useRef(/** @type {number | null} */ (null));
  const onTouchStart = (e) => { touchStartX.current = e.touches[0]?.clientX ?? null; };
  const onTouchEnd = (e) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? start) - start;
    if (Math.abs(dx) < 40) return;
    cyclePreset(dx < 0 ? 1 : -1);
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

  // Кнопка загрузки своего фото — иконка-кнопка. В hero-режиме живёт в углу
  // обложки; переиспользуется тем же обработчиком, что и прежняя плитка ленты.
  const uploadBtn = (
    <IconBtn
      icon="image-up"
      disabled={uploading}
      onClick={handlePickFile}
      ariaLabel={uploading ? t('trip.form_uploading') : t('trip.form_upload_image')}
      className="tcp__ctl tcp__upload"
    />
  );

  return (
    <div className="col col--g6">
      {heroClassName ? (
        /* Hero-режим (планнер): большая обложка на всю ширину. Загрузка — иконкой
           в правом верхнем углу; стрелки по бокам МЕНЯЮТ выбранный кавер (не
           скроллят ленту); heroOverlay — название трипа поверх низа обложки. */
        <div className={heroClassName} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <img className="tc__img" src={coverImageUrl || COVER_FALLBACK} alt="" />
          <div className="tc__scrim" />
          {uploadBtn}
          {presets.length > 1 && (
            <>
              <IconBtn icon="chevL" ariaLabel={t('common.prev')} onClick={() => cyclePreset(-1)} className="tcp__ctl tcp__nav tcp__nav--prev" />
              <IconBtn icon="chev" ariaLabel={t('common.next')} onClick={() => cyclePreset(1)} className="tcp__ctl tcp__nav tcp__nav--next" />
            </>
          )}
          {heroOverlay && <div className="pl-cover__title t-title">{heroOverlay}</div>}
        </div>
      ) : (
        showPreview && (
          /* TRIP-343 объект 2 (G): превью обложки — постер-форма <Card pad="none">;
             скин (рамка+радиус+фон) на примитиве, `.tcp__preview` — раскладка.
             Обложки нет → показываем ту же фоллбек-картинку, что увидит трип. */
          <Card pad="none" radius="md" className="tcp__preview">
            <img src={coverImageUrl || COVER_FALLBACK} alt="" className="tcp__img" />
          </Card>
        )
      )}

      <Carousel className="tcp__strip" ariaLabel={t('trip.cover_gallery')} ref={stripRef}>
        {/* Вне hero-режима (Settings) загрузка — ведущая плитка ленты; в hero-режиме
            она уехала в угол обложки, поэтому здесь её нет. */}
        {!heroClassName && (
          <Swatch
            variant="round"
            icon="upload"
            disabled={uploading}
            onClick={handlePickFile}
            aria-label={uploading ? t('trip.form_uploading') : t('trip.form_upload_image')}
          />
        )}
        {presets.map((p, i) => {
          /* Плитка пресета — примитив <Swatch variant="round"> (его round-вариант и
             ЕСТЬ обложка-свотч, TRIP-344): выбор = aria-pressed, картинка — фоном.
             Выбор пресета копирует его URL в cover_image_url (как аплоад). Фон из
             данных держим переменной (гард 2l не считает `style={var}`), как в
             VisitPanel/TripDot. data-idx — адрес для доводчика стрелок обложки. */
          const swatchStyle = { backgroundImage: `url(${p.image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' };
          return (
            <Swatch
              key={p.id}
              variant="round"
              on={coverImageUrl === p.image_url}
              onClick={(e) => handlePickPreset(p.image_url, e.currentTarget)}
              aria-label={t('trip.cover_preset')}
              style={swatchStyle}
              data-idx={i}
            />
          );
        })}
      </Carousel>
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        onChange={handleUpload}
        className="tcp__file"
      />

      {error && <p className="tcp__err">{error}</p>}
    </div>
  );
}
