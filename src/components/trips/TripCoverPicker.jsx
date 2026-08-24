import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CoverPicker } from '@/design/index';
import { supabase } from '@/api/supabaseClient';
import { invokeFn } from '@/lib/invokeFn';
import { TRIP_BUCKET, SIGNED_URL_TTL, tripStoragePath, draftStoragePath } from '@/lib/storage';
import { collectDocPaths, removeTripFiles } from '@/lib/storageCleanup';
import { report } from '@/lib/reportDataError';
import { isAllowedUpload, ALLOWED_IMAGE_EXTENSIONS, IMAGE_ACCEPT } from '@/lib/fileType';
import { uploadErrorText } from '@/lib/documentMutations';
import { useT } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import { composeCoverSlides } from '@/lib/coverSlides';

// Экспорт: тот же потолок держит фон share-карточки (ShareCardDialog) — картинка
// одного класса, кэп один.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // 4 MB

// Каталог пресетов читаем через edge-витрину getCoverPresets (дверь auth,
// service_role) — прямого клиентского SELECT нет (эпик «единая дверь» TRIP-374).
// Экспорт: тот же каталог (и тот же react-query ключ ['coverPresets']) листает
// фоны share-карточки (ShareCardDialog) — источник картинок один.
export async function fetchCoverPresets() {
  const { data, error } = await invokeFn('getCoverPresets', { body: {} });
  if (error) throw new Error('getCoverPresets failed');
  return data?.presets || [];
}

/**
 * Обложка трипа = примитив ДС `<CoverPicker>` (лента, стрелки, миниатюры,
 * кнопка загрузки) + ЭТОТ адаптер, который знает ровно две вещи, которых
 * примитиву знать нельзя: откуда берутся картинки (каталог пресетов
 * `getCoverPresets`) и куда девается своё фото (бакет `trips` в Storage).
 * Обе стороны пишут ОДНО поле: выбор пресета КОПИРУЕТ его публичный url в
 * `cover_image_url` ровно как аплоад, поэтому снятие пресета из галереи не
 * ломает трип, который его уже выбрал. Градиентов нет — пустая обложка
 * рисуется фоллбек-картинкой из бандла.
 *
 * `onChange({ cover_image_url })` — СООБЩЕНИЕ о выборе, а не запись: в планнере
 * это черновик шага, в настройках трипа — поле формы с кнопкой «Сохранить».
 */
export default function TripCoverPicker({
  coverImageUrl = '',
  tripId,
  onChange,
  disabled = false,
  // Что сейчас СОХРАНЕНО в этом поле (форма знает, пикер — нет). Задано →
  // при уходе с экрана подметаем залитые этой сессией, но не сохранённые байты.
  savedUrl,
  // Шаг создания открывается БЕЗ обложки, и уехать с пустой из него нельзя —
  // как только каталог загрузился, берём первый пресет. В настройках трипа
  // наоборот: молча выбранная обложка пометила бы форму грязной при простом
  // открытии экрана, поэтому по умолчанию выключено.
  autoSelect = false,
  // Раскладка/геометрия кадра обложки (планнер — full-bleed полоса `.pl-cover`).
  className = '',
  // Контент поверх низа обложки (в планнере — <EditableText> с названием трипа).
  overlay = null,
}) {
  const t = useT();
  const { user } = useAuth();
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
  // Уход с экрана без сохранения оставил бы залитые байты сиротой в бакете:
  // строки в БД нет, а файл есть. Что именно СОХРАНЕНО, пикер знать не может —
  // это говорит форма (`savedUrl`), и без её ответа мы не подметаем ничего:
  // удалить живую обложку по догадке хуже, чем оставить лишний файл.
  const saved = useRef(savedUrl);
  saved.current = savedUrl;
  useEffect(() => () => {
    if (saved.current === undefined) return;
    const orphans = [...stagedUrls.current].filter((u) => u !== saved.current);
    if (orphans.length) removeTripFiles(collectDocPaths(orphans.map((u) => ({ file_url: u }))));
  }, []);

  const { data: presets = [], isPending: presetsPending } = useQuery({
    queryKey: ['coverPresets'],
    queryFn: fetchCoverPresets,
    // Набор курируется вручную и меняется редко — держим час, чтобы переход
    // между создать/настройки не бил edge заново.
    staleTime: 60 * 60 * 1000,
  });
  const presetUrls = useMemo(() => presets.map((p) => p.image_url), [presets]);

  // Состав ленты — чистая функция (`composeCoverSlides`, закрыта тестом): она
  // кладёт ТЕКУЩУЮ обложку в список сразу, не дожидаясь каталога, и вычитает из
  // ведущей группы всё, что в каталоге уже есть. Отсюда экран открывается на
  // своей обложке, а не на фоллбеке, и пресетная обложка не двоится.
  //
  // `extraSlides` — ИСТОРИЯ своих загрузок, а не источник текущей: прежнее фото
  // обязано остаться в ленте после выбора пресета, иначе список схлопывается
  // ровно в тот момент, когда человек в нём листает. Поэтому пополняется
  // эффектом (после кадра) — на первый кадр он не влияет.
  const [blankSlide] = useState(() => coverImageUrl === '');
  const [extraSlides, setExtraSlides] = useState(/** @type {string[]} */ ([]));
  useEffect(() => {
    if (!coverImageUrl || extraSlides.includes(coverImageUrl)) return;
    setExtraSlides((s) => [coverImageUrl, ...s]);
  }, [coverImageUrl, extraSlides]);
  const slides = useMemo(
    () => composeCoverSlides({ value: coverImageUrl, extras: extraSlides, presets: presetUrls, blank: blankSlide }),
    [coverImageUrl, extraSlides, presetUrls, blankSlide],
  );

  useEffect(() => {
    if (autoSelect && !coverImageUrl && presetUrls.length > 0) {
      onChange({ cover_image_url: presetUrls[0] });
    }
  }, [autoSelect, coverImageUrl, presetUrls, onChange]);

  const handleUpload = async (file) => {
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
    <CoverPicker
      slides={slides}
      value={coverImageUrl}
      onChange={(url) => { sweepIfStaged(coverImageUrl); onChange({ cover_image_url: url }); }}
      onUpload={disabled ? undefined : handleUpload}
      uploading={uploading}
      error={error}
      disabled={disabled}
      loading={presetsPending}
      className={className}
      overlay={overlay}
      accept={IMAGE_ACCEPT}
      ariaLabel={t('trip.cover_gallery')}
      uploadLabel={uploading ? t('trip.form_uploading') : t('trip.form_upload_image')}
    />
  );
}
