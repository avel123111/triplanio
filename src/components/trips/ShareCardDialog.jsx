import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { track } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useIsPhone } from '@/hooks/use-mobile';
import { Btn, Carousel, Dialog, EmptyState, IconBtn, Seg, Severity, Skeleton, Swatch, Tile } from '@/design/index';
import { Icon } from '@/design/icons';
import LpSheet from '@/components/ui/LpSheet';
import { renderCardMapPng, blobToDataUri, rasterizeSvgToPng } from '@/lib/map/captureMap';
import { isAllowedUpload, ALLOWED_IMAGE_EXTENSIONS, IMAGE_ACCEPT } from '@/lib/fileType';
import { invokeCard, applyCardBg, cardBgUri, fetchImageDataUri, MAP_PLACEHOLDER } from './shareCard';
import { fetchCoverPresets } from './TripCoverPicker';
import ShareMapPreview from './ShareMapPreview';
import './ShareCardDialog.css';

// Тот же потолок, что у загрузки обложки трипа (TripCoverPicker.MAX_UPLOAD_BYTES):
// фон уходит data-URI прямо в SVG, тяжелее — растеризация встанет.
const MAX_BG_BYTES = 4 * 1024 * 1024; // 4 MB

// Заглушки миниатюр, пока едет каталог фонов (как у CoverPicker: ряд должен
// читаться «сейчас будет ещё», а не прыгать с одной плитки до десятка).
const SKELETON_THUMBS = [0, 1, 2];

// Конструктор share-карточки (share-UX эксперимент поверх TRIP-193).
// Одна сцена вместо двух стадий edit→card:
//   · превью = живая карта-калька (без жестов) под рамкой-SVG с выбранным фоном —
//     ровно то, что уйдёт в PNG; «Скачать»/«Поделиться» собирают файл на месте;
//   · фон — стрелки по бокам превью + карусель миниатюр под ним (язык CoverPicker:
//     классы tcp__*, Swatch, Carousel); своё фото едет data-URI без Storage;
//   · карта — ОТДЕЛЬНЫЙ полноэкранный под-флоу (кнопка «Настроить карту»):
//     тот же ShareMapPreview, но живой и крупный; Done возвращает композицию.
// Оболочка: десктоп — Dialog wide, телефон — полноэкранный шит .lp-sheet
// (единственный канон 100%-высоты, тот же, что у панелей редактора).
export default function ShareCardDialog({ trip, open, onOpenChange, visits = [], transfers = [] }) {
  const { t, lang } = useI18n();
  const isPhone = useIsPhone();

  const [format, setFormat] = useState('story');
  const [overlay, setOverlay] = useState(null); // { svg, slot, w, h }
  const [overlayCode, setOverlayCode] = useState(''); // '' | 'error' | 'no_transit_cities'
  const [bg, setBg] = useState(''); // '' = штатный фон | url пресета | data-URI своего фото
  const [bgUri, setBgUri] = useState(''); // фон, готовый к инлайну в SVG
  const [uploaded, setUploaded] = useState(''); // data-URI своего фото (слайд этой сессии)
  const [uploadError, setUploadError] = useState('');
  const [camera, setCamera] = useState(null); // композиция из редактора карты; null = авто-фит
  const [editorOpen, setEditorOpen] = useState(false);
  const [building, setBuilding] = useState(''); // '' | 'share' | 'download'
  const [buildError, setBuildError] = useState('');

  const previewRef = useRef(null);
  const editorRef = useRef(null);
  const fileRef = useRef(null);
  const builtRef = useRef(null); // последний собранный PNG (blob); обнуляется на смену входов

  // Рамка (и слот карты) — с edge-функции, отдельно на каждый формат.
  useEffect(() => {
    if (!open || !trip?.id) return undefined;
    let cancelled = false;
    setOverlay(null);
    setOverlayCode('');
    invokeCard({ trip_id: trip.id, format, lang, mode: 'overlay' })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (data?.code) { setOverlayCode(data.code); return; }
        if (error || !data?.svg) { setOverlayCode('error'); return; }
        setOverlay({ svg: data.svg, slot: data.slot, w: data.width, h: data.height });
      })
      .catch((e) => { if (!cancelled) { console.error('overlay fetch failed', e); setOverlayCode('error'); } });
    return () => { cancelled = true; };
  }, [open, trip?.id, format, lang]);

  // Каталог фонов = пресеты обложек (одна коллекция и один query-ключ с пикером
  // обложки; своя коллекция фонов приедет позже — источник уже один).
  const presetsQ = useQuery({
    queryKey: ['coverPresets'],
    queryFn: fetchCoverPresets,
    staleTime: 60 * 60 * 1000,
    enabled: open,
  });
  const slides = useMemo(() => {
    const urls = (presetsQ.data || []).map((p) => p.image_url);
    return ['', ...(uploaded ? [uploaded] : []), ...urls];
  }, [presetsQ.data, uploaded]);

  // Выбранный фон → data-URI (пресет качается и мемоизируется, своё фото уже URI).
  useEffect(() => {
    let cancelled = false;
    if (!bg) { setBgUri(''); return undefined; }
    if (bg.startsWith('data:')) { setBgUri(bg); return undefined; }
    fetchImageDataUri(bg)
      .then((uri) => { if (!cancelled) setBgUri(uri); })
      .catch(() => { if (!cancelled) { setBg(''); setBgUri(''); } });
    return () => { cancelled = true; };
  }, [bg]);

  // Смена входов обнуляет собранный PNG.
  useEffect(() => { builtRef.current = null; setBuildError(''); }, [format, bg, camera]);

  const framedSvg = useMemo(() => (overlay ? applyCardBg(overlay.svg, bgUri) : null), [overlay, bgUri]);
  // Миниатюра «Стандарт» — штатный фон, вытащенный из самого шаблона.
  const standardThumb = useMemo(() => (overlay ? cardBgUri(overlay.svg) : ''), [overlay]);

  const ready = Boolean(overlay) && !overlayCode;
  const arStyle = overlay
    ? { '--sc-ar': `${overlay.w} / ${overlay.h}`, '--sc-arw': overlay.w / overlay.h }
    : undefined;

  // Фон миниатюр — картинка ИЗ ДАННЫХ (data-URI шаблона / url пресета), классом
  // её не выразить; едет переменной, как у CoverPicker.
  const thumbStyle = (url) => ({ backgroundImage: `url(${url})`, backgroundSize: 'cover', backgroundPosition: 'center' });

  const bgIdx = slides.indexOf(bg);
  const canPrevBg = bgIdx > 0;
  const canNextBg = bgIdx !== -1 && bgIdx < slides.length - 1;
  const stepBg = (dir) => {
    const next = slides[bgIdx + dir];
    if (next !== undefined) setBg(next);
  };

  function pickFile() { fileRef.current?.click(); }
  function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isAllowedUpload(file, ALLOWED_IMAGE_EXTENSIONS)) { setUploadError(t('doc.bad_format')); return; }
    if (file.size > MAX_BG_BYTES) { setUploadError(t('trip.cover_too_large')); return; }
    setUploadError('');
    blobToDataUri(file)
      .then((uri) => { setUploaded(uri); setBg(uri); })
      .catch(() => setUploadError(t('trip.cover_upload_failed')));
  }

  // Финальный PNG: карта в полном разрешении слота (камера превью или редактора)
  // → card_svg с подменённым фоном → растеризация в браузере. Кэш на неизменных
  // входах — повторное «Скачать» после «Поделиться» не пересобирает.
  async function buildPng() {
    if (builtRef.current) return builtRef.current;
    const comp = camera || previewRef.current?.getComposition?.();
    const slot = overlay?.slot;
    if (!comp || !slot) throw new Error('preview not ready');
    // Фон разрешается ЗДЕСЬ из выбора (bg), а не из стейта превью (bgUri):
    // клик «Скачать» в окно, пока data-URI пресета ещё качается, иначе собрал
    // бы и закэшировал карточку со штатным фоном. Кэш fetchImageDataUri общий
    // с превью — второй раз пресет не качается.
    const finalBgUri = bg ? (bg.startsWith('data:') ? bg : await fetchImageDataUri(bg)) : '';
    const mapBlob = await renderCardMapPng({ visits, transfers, ...comp, width: slot.w, height: slot.h });
    if (!mapBlob) throw new Error('map render failed');
    const mapUri = await blobToDataUri(mapBlob);
    const { data, error } = await invokeCard({ trip_id: trip.id, format, lang, mode: 'card_svg' });
    if (error || !data?.svg) throw new Error('card svg failed');
    const svg = applyCardBg(data.svg, finalBgUri).split(MAP_PLACEHOLDER).join(mapUri);
    const blob = await rasterizeSvgToPng(svg, data.width || overlay.w, data.height || overlay.h);
    builtRef.current = blob;
    track('share_card_generated', { trip_id: trip.id, format, bg: bg ? 'custom' : 'standard' });
    return blob;
  }

  function saveBlob(blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `triplanio-${format}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  async function downloadCard() {
    setBuilding('download');
    setBuildError('');
    try { saveBlob(await buildPng()); } catch (e) {
      console.error('card build failed', e);
      setBuildError(t('share.card_error'));
    } finally { setBuilding(''); }
  }

  async function shareCard() {
    setBuilding('share');
    setBuildError('');
    try {
      const blob = await buildPng();
      const file = new File([blob], `triplanio-${format}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        saveBlob(blob);
      }
    } catch (e) {
      // AbortError = человек закрыл системный шит шаринга; это не сбой.
      if (e?.name !== 'AbortError') { console.error('share card failed', e); setBuildError(t('share.card_error')); }
    } finally { setBuilding(''); }
  }

  const closeEditor = () => setEditorOpen(false);
  function applyEditor() {
    const comp = editorRef.current?.getComposition?.();
    if (comp) setCamera(comp);
    closeEditor();
  }

  const close = () => onOpenChange?.(false);

  // «Городов нет» — не сбой, а пустой маршрут: заглушка другого тона и текста.
  const noCities = overlayCode === 'no_transit_cities';
  const body = overlayCode ? (
    <EmptyState
      kind={noCities ? 'empty' : 'error'}
      icon="map"
      title={noCities ? t('share.card_no_cities') : t('share.card_error')}
    />
  ) : (
    <div className="sc-body">
      <div className="sc-stage" style={arStyle}>
        {overlay ? (
          <ShareMapPreview
            key={format}
            ref={previewRef}
            visits={visits}
            transfers={transfers}
            lang={lang}
            overlaySvg={framedSvg}
            slot={overlay.slot}
            cardW={overlay.w}
            cardH={overlay.h}
            interactive={false}
            camera={camera}
          />
        ) : (
          <Skeleton w="100%" h="100%" r={0} />
        )}
        {ready && canPrevBg && (
          <IconBtn icon="chevL" className="tcp__ctl tcp__nav tcp__nav--prev" ariaLabel={t('common.prev')} onClick={() => stepBg(-1)} />
        )}
        {ready && canNextBg && (
          <IconBtn icon="chev" className="tcp__ctl tcp__nav tcp__nav--next" ariaLabel={t('common.next')} onClick={() => stepBg(1)} />
        )}
        {ready && (
          <IconBtn icon="image-up" className="tcp__ctl tcp__upload" ariaLabel={t('share.bg_upload')} title={t('share.bg_upload')} onClick={pickFile} />
        )}
      </div>

      {/* Карусель фонов — свой грид-остров (.sc-strip): десктоп ставит её в
          ПРАВУЮ колонку под подсказку, мобила — под превью (см. areas в CSS). */}
      <Carousel className="tcp__strip sc-strip" ariaLabel={t('share.card_bg')}>
        {standardThumb && (
          <Swatch
            variant="round"
            on={bg === ''}
            onClick={() => setBg('')}
            aria-label={t('share.card_bg_standard')}
            title={t('share.card_bg_standard')}
            style={thumbStyle(standardThumb)}
          />
        )}
        {slides.slice(1).map((url, i) => (
          <Swatch
            key={url.slice(0, 80) || `bg-${i}`}
            variant="round"
            on={bg === url}
            onClick={() => setBg(url)}
            aria-label={t('share.card_bg')}
            style={thumbStyle(url)}
          />
        ))}
        {(presetsQ.isLoading || !overlay) && SKELETON_THUMBS.map((k) => (
          <Skeleton key={k} w={52} h={52} r={'var(--r-xs)'} />
        ))}
      </Carousel>

      <div className="sc-side">
        {/* .grow: на мобиле управление встаёт РЯДОМ (формат + карта), сегмент
            забирает остаток ряда; в десктоп-колонке просто растянут. */}
        <span className="grow">
          <Seg
            variant="fill"
            ariaLabel={t('share.card_title')}
            value={format}
            onChange={setFormat}
            options={[
              { value: 'story', label: t('share.card_story') },
              { value: 'post', label: t('share.card_post') },
            ]}
          />
        </span>
        <Btn variant="secondary" icon="map" disabled={!ready} onClick={() => setEditorOpen(true)}>
          {t('share.edit_map')}
        </Btn>
        {!isPhone && <div className="muted t-body">{t('share.menu_card_hint')}</div>}
        {uploadError && <p className="tcp__err">{uploadError}</p>}
        {buildError && <Severity level="error">{buildError}</Severity>}
      </div>

      <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} onChange={handleFile} className="tcp__file" />
    </div>
  );

  const foot = (
    <>
      <Btn variant="secondary" icon="download" loading={building === 'download'} disabled={!ready || !!building} onClick={downloadCard}>
        {t('share.card_download')}
      </Btn>
      <Btn variant="primary" icon="share" loading={building === 'share'} disabled={!ready || !!building} onClick={shareCard}>
        {t('share.card_share')}
      </Btn>
    </>
  );

  // Живая карта под-флоу — ОДНА на оба шасси (шит на телефоне, диалог на
  // десктопе): один ref, иначе Done забрал бы композицию не той. Карта здесь
  // ГОЛАЯ и крупная: без рамки карточки, в пропорции СЛОТА (дыры под карту) —
  // редактируешь карту, а не карточку; кадр по ширине совпадает с дырой
  // (камера ездит композицией с пересчётом зума под ширину поверхности).
  const editorAr = overlay
    ? { '--sc-ar': `${overlay.slot.w} / ${overlay.slot.h}`, '--sc-arw': overlay.slot.w / overlay.slot.h }
    : undefined;
  const editorStage = overlay && (
    <div className="sc-stage" style={editorAr}>
      <ShareMapPreview
        ref={editorRef}
        visits={visits}
        transfers={transfers}
        lang={lang}
        bare
        cardW={overlay.slot.w}
        camera={camera}
      />
    </div>
  );

  // Полноэкранный под-флоу «Настроить карту»: крупная живая карта с жестами,
  // Done забирает композицию, крестик — отменяет.
  const editor = editorOpen && overlay && (isPhone ? (
    <LpSheet open onClose={closeEditor} title={t('share.edit_map')}>
      <div className="lp">
        <div className="lp-h">
          <Tile as="span" className="lp-ic"><Icon name="map" size={17} /></Tile>
          <div className="lp-ti"><div className="lp-tirow"><b className="t-title">{t('share.edit_map')}</b></div></div>
          <IconBtn icon="close" onClick={closeEditor} ariaLabel={t('common.close')} />
        </div>
        {/* data-vaul-no-drag: жесты карты не должны утаскивать сам шит */}
        <div className="lp-b sc-edit" data-vaul-no-drag>
          <div className="muted t-body">{t('share.card_map_hint')}</div>
          {editorStage}
        </div>
        <div className="lp-f lp-f--single">
          <Btn variant="primary" icon="check" block onClick={applyEditor}>{t('common.done')}</Btn>
        </div>
      </div>
    </LpSheet>
  ) : (
    <Dialog
      title={t('share.edit_map')}
      subtitle={t('share.card_map_hint')}
      icon="map"
      size="wide"
      open
      onOpenChange={(o) => { if (!o) closeEditor(); }}
      foot={<Btn variant="primary" icon="check" onClick={applyEditor}>{t('common.done')}</Btn>}
    >
      <div className="sc-edit">{editorStage}</div>
    </Dialog>
  ));

  if (isPhone) {
    return (
      <>
        <LpSheet open={open} onClose={close} title={t('share.card_title')}>
          <div className="lp">
            <div className="lp-h">
              <Tile as="span" className="lp-ic"><Icon name="image" size={17} /></Tile>
              <div className="lp-ti"><div className="lp-tirow"><b className="t-title">{t('share.card_title')}</b></div></div>
              <IconBtn icon="close" onClick={close} ariaLabel={t('common.close')} />
            </div>
            <div className="lp-b">{body}</div>
            {!overlayCode && <div className="lp-f">{foot}</div>}
          </div>
        </LpSheet>
        {editor}
      </>
    );
  }
  return (
    <>
      <Dialog title={t('share.card_title')} icon="image" size="wide" open={open} onOpenChange={onOpenChange} foot={overlayCode ? undefined : foot}>
        {body}
      </Dialog>
      {editor}
    </>
  );
}
