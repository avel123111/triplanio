// @ts-check
/**
 * EventAiBlock — "parse a booking with AI" widget (Lumo `.ai-blk`).
 * States: locked / available / idle / uploaded / parsing / parsed.
 *
 * Recognition runs server-side: the browser uploads file(s) to Supabase Storage,
 * then calls the `parseBookingWithAi` edge function with { kind, fileUrls, text }.
 * That function forwards to the n8n webhook (per-kind prompts + schemas + LLM).
 *
 * `onExtract(data, fileUrl, fileName)` is called with the parsed JSON plus the
 * uploaded documents; the parent maps the values into its form.
 */
import React, { useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { supabase } from '@/api/supabaseClient';
import { invokeFn } from '@/lib/invokeFn';
import { useI18n } from '@/lib/i18n/I18nContext';
import { TRIP_BUCKET, SIGNED_URL_TTL, tripStoragePath } from '@/lib/storage';
import { removeTripFiles } from '@/lib/storageCleanup';
import { uploadErrorText } from '@/lib/documentMutations';
import { canonTransportType } from '@/lib/transport';
import { isAllowedUpload, ALLOWED_PARSER_EXTENSIONS, PARSER_ACCEPT } from '@/lib/fileType';
import { Btn, Card, FileRow, IconBtn, InputGroup, Textarea, Tile } from '@/design/index';
import { formatBytes } from '@/lib/formatBytes';
import {
  Sparkles, Lock, X,
  ChevronUp, Check,
} from 'lucide-react';

const MAX_FILES = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

// n8n wraps the webhook response differently depending on which node answers:
// a bare object, an array of items, a { kind, data } envelope, or a node-named
// wrapper like { output: {...} }. Descend through any of those wrappers until we
// reach the object that actually carries the booking fields.
function extractBookingPayload(node, depth = 0) {
  if (node == null || depth > 6) return node || {};
  if (Array.isArray(node)) return extractBookingPayload(node[0], depth + 1);
  if (typeof node !== 'object') return {};
  const isBooking = ['transfers', 'waypoints', 'segments', 'name', 'from_address', 'check_in_date', 'booking_reference', 'booking_url']
    .some((k) => k in node);
  if (isBooking) return node;
  for (const key of ['output', 'data', 'json', 'body', 'result', 'response']) {
    if (node[key] != null) return extractBookingPayload(node[key], depth + 1);
  }
  const keys = Object.keys(node);
  if (keys.length === 1) return extractBookingPayload(node[keys[0]], depth + 1);
  return node;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function EventAiBlock({
  kind, // 'hotel' | 'transfer'
  state, // 'locked' | 'available' | 'idle' | 'uploaded' | 'parsing' | 'parsed'
  setState,
  onExtract,
  onUpgrade,
  parsedFieldCount = 0,
  onReset,
  tripId, // required by the server-side Pro/membership gate (parseBookingWithAi)
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]); // { file, name, file_url? }
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const addFiles = (list) => {
    if (!list?.length) return;
    setError(null);
    const incoming = Array.from(list).filter((f) => {
      // `accept` only filters the picker dialog, not drag-and-drop (TRIP-281).
      if (!isAllowedUpload(f, ALLOWED_PARSER_EXTENSIONS)) {
        setError(t('doc.bad_format', { name: f.name }));
        return false;
      }
      if (f.size > MAX_FILE_BYTES) {
        setError(t('event.ai_file_too_big5', { name: f.name }));
        return false;
      }
      return true;
    });
    if (!incoming.length) return;
    setFiles((prev) => {
      const space = MAX_FILES - prev.length;
      const toAdd = incoming.slice(0, space).map((f) => ({ file: f, name: f.name }));
      if (incoming.length > space) setError(t('event.ai_max_files', { max: MAX_FILES }));
      const next = [...prev, ...toAdd];
      if (next.length > 0 && state === 'idle') setState('uploaded');
      return next;
    });
  };

  const removeFile = (idx) => {
    setFiles((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length === 0 && state === 'uploaded') setState('idle');
      return next;
    });
  };

  // Recognition - uploads any local files to Supabase Storage, then calls the
  // parseBookingWithAi edge function (which forwards to the n8n workflow that
  // holds the per-kind prompts + schemas and runs the LLM).
  const runParse = async () => {
    setError(null);
    setState('parsing');
    track('booking_ai_parse_started', { kind, has_files: files.length > 0, has_text: text.trim().length > 0, trip_id: tripId });
    // Objects uploaded for THIS attempt. On any non-success exit they're orphans
    // (the parse result is discarded and a retry re-uploads), so sweep them
    // best-effort — otherwise every failed/retried parse leaked files (TRIP-117).
    const uploadedPaths = [];
    try {
      // 1. Upload local files to Storage → long-lived signed URLs.
      const uploaded = await Promise.all(files.map(async (f) => {
        if (f.file_url) return f;
        // tripStoragePath sanitises the filename (Supabase Storage rejects
        // non-ASCII / special chars → "Invalid key"); the real name is kept for
        // display via `documents` below.
        const path = tripStoragePath(tripId, f.name);
        const { error: upErr } = await supabase.storage.from(TRIP_BUCKET).upload(path, f.file);
        // Storage-ошибка (кода НЕТ) → её дом uploadErrorText, не сырой показ .message.
        if (upErr) {
          const storageMsg = upErr.message;
          throw new Error(uploadErrorText({ file: f, reason: 'upload', message: storageMsg }, t));
        }
        uploadedPaths.push(path);
        const { data: urlData } = await supabase.storage.from(TRIP_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
        return { ...f, file_url: urlData?.signedUrl || '', storage_path: path };
      }));
      const fileUrls = uploaded.map((f) => f.file_url).filter(Boolean);

      // 2. Call the edge function. kind + fileUrls + the pasted text all go to
      //    n8n (prompts and schemas live inside the n8n workflow).
      const body = { kind, fileUrls, text: text.trim(), trip_id: tripId };
      const { data: invoked, error: invokeErr } = await invokeFn('parseBookingWithAi', { body });
      if (invokeErr) {
        // TRIP-111: серверный гейт — отдельные сообщения для лимита и Pro.
        const status = invokeErr?.context?.status;
        if (status === 429) { setError(t('event.ai_rate_limited')); setState('uploaded'); removeTripFiles(uploadedPaths); return; }
        if (status === 403) { setError(t('event.ai_pro_required')); setState('uploaded'); removeTripFiles(uploadedPaths); return; }
        throw invokeErr;
      }
      if (invoked?.error) throw new Error(invoked.error);

      const result = extractBookingPayload(invoked);

      // New transfer shape = result.transfers[] (legs) + result.waypoints[].
      // Older shape used result.segments[]. Normalise transport_type synonyms.
      const legs = kind === 'transfer'
        ? (Array.isArray(result.transfers) ? result.transfers
          : (Array.isArray(result.segments) ? result.segments : null))
        : null;
      if (legs) {
        legs.forEach((s) => { if (s?.transport_type) s.transport_type = canonTransportType(s.transport_type); });
      }
      if (kind === 'transfer' && !legs) result.transfers = [{}];

      const documents = uploaded
        .filter((u) => u.file_url)
        .map((u) => ({ file_url: u.file_url, file_name: u.name, storage_path: u.storage_path }));
      track('booking_ai_parse_completed', { kind, field_count: parsedFieldCount, trip_id: tripId });
      onExtract(
        { ...result, documents },
        documents[0]?.file_url || null,
        documents[0]?.file_name || null,
      );
    } catch (e) {
      // Parse failed → the uploaded objects are orphaned (result discarded);
      // sweep them so a retry doesn't pile up new ones (TRIP-117).
      removeTripFiles(uploadedPaths);
      // supabase.functions.invoke surfaces a generic "Edge Function returned a
      // non-2xx status code" when the edge fn / n8n can't read the document.
      // Show a clear, friendly hint instead of that raw string. Explicit thrown
      // messages (e.g. upload errors) are kept as-is.
      const raw = typeof e?.message === 'string' ? e.message : '';
      const isParseFailure = e?.name === 'FunctionsHttpError' || /non-2xx|edge function/i.test(raw);
      setError(isParseFailure ? t('event.ai_parse_error') : (raw || t('event.ai_parse_error')));
      setState('uploaded');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  // Canonical AI pattern — design-system A4. Парсер НЕ несёт Pro-бейджа ни в одном
  // состоянии: locked → иконка замка; остальные → без бейджа (TRIP-187).

  // checking — Pro/entitlement status not yet resolved. Render a non-interactive
  // placeholder (NOT the clickable 'available' pill) so a non-Pro user can't open
  // and use the parser before the check lands.
  if (state === 'checking') {
    return (
      <Card tone="ai" ariaBusy pad="none" className="ai-blk">
        <div className="ai-blk-hd">
          <Tile tone="ai" solid size="sm"><Sparkles size={15} /></Tile>
          <div className="ai-blk-ti">
            <b>{t('event.ai_fill_title')}</b>
            <span>{t('event.ai_available_hint')}</span>
          </div>
          <span className="spin spin--ring" />
        </div>
      </Card>
    );
  }

  if (state === 'locked') {
    return (
      <Card tone="ai" locked pad="none" className="ai-blk">
        <div className="ai-blk-hd">
          <Tile tone="ai" solid size="sm"><Sparkles size={15} /></Tile>
          <div className="ai-blk-ti">
            {/* Заблокировано (Free): замок вместо PRO-бейджа (дизайн-система TRIP-187) */}
            <b>{t('event.ai_fill_title')}<Lock size={12} className="muted" /></b>
            <span>{t('event.ai_locked_hint')}</span>
          </div>
          <Btn variant="pro" onClick={onUpgrade}>
            <Sparkles style={{ width: 13, height: 13, marginRight: 5 }} />{t('trips.go_pro')}
          </Btn>
        </div>
      </Card>
    );
  }

  if (state === 'parsing') {
    return (
      <Card tone="ai" pad="none" className="ai-blk">
        <div className="ai-blk-hd">
          <Tile tone="ai" solid size="sm"><Sparkles size={15} /></Tile>
          <div className="ai-blk-ti">
            <b>{t('event.ai_parsing')}<span className="spin spin--ring" /></b>
            {files[0]?.name && <span>{files[0].name}</span>}
            <div className="ai-prog"><div className="ai-prog-fill" /></div>
          </div>
        </div>
      </Card>
    );
  }

  if (state === 'parsed') {
    return (
      <Card tone="ai" parsed pad="none" className="ai-blk">
        <div className="ai-blk-hd">
          <Tile tone="success" solid size="sm"><Check size={15} /></Tile>
          <div className="ai-blk-ti">
            <b>{t('event.ai_filled', { count: parsedFieldCount, fields: pluralFields(t, parsedFieldCount) })}</b>
            <span>{t('event.ai_highlighted_hint')}</span>
          </div>
          {/* Была сырая разметка с классами системы; значок ехал своим инлайном
              на размер и зазор, хотя ровно это <Btn icon> и делает. */}
          <Btn variant="secondary" icon="refresh" onClick={() => { onReset?.(); setText(''); setFiles([]); setState('idle'); }}>
            {t('event.ai_reset')}
          </Btn>
          <IconBtn
            icon="chevU"
            tone="ai"
            size="sm"
            onClick={() => setState('available')}
            ariaLabel={t('event.collapse')}
          />
        </div>
      </Card>
    );
  }

  // available / idle / uploaded — ОДНА оболочка. Шапка структурно неизменна во
  // всех трёх (плитка + заголовок + шеврон), поэтому при раскрытии/скрытии ничего
  // не «дёргается». Тело рендерится ТОЛЬКО в открытом состоянии — в свёрнутом его
  // в DOM нет (ничего не «торчит»), появляется лёгкой анимацией (.ai-blk-body--in).
  const open = state !== 'available';
  const toggle = () => setState(open ? 'available' : 'idle');
  return (
    <Card tone="ai" pad="none" className={'ai-blk' + (open ? ' ai-blk--open' : '')}>
      <div
        className="ai-blk-hd"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
      >
        <Tile tone="ai" solid size="sm"><Sparkles size={15} /></Tile>
        <div className="ai-blk-ti">
          <b>{t('event.ai_fill_title')}</b>
          <span>{state === 'uploaded'
            ? `${files.length} ${files.length === 1 ? t('event.ai_file_ready_one') : t('event.ai_file_ready_many')} ${t('event.ai_files_ready_suffix')}`
            : t('event.ai_available_hint')}</span>
        </div>
        <span className="ai-blk-x" aria-hidden="true"><ChevronUp size={14} /></span>
      </div>

      {/* Тело ВСЕГДА в DOM (иначе анимации скрытия нет) — но в свёрнутом схлопнуто
          в ноль: grid-template-rows 0fr→1fr, а `.ai-blk__reveal-inner` (overflow
          + min-height:0) клипует паддинговое тело досуха (проверено фикстурой:
          closed=0px). Раскрытие/скрытие плавное в обе стороны, ничего не «торчит». */}
      <div className="ai-blk__reveal">
        <div className="ai-blk__reveal-inner">
          <div className="ai-blk-body"
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
          >
          {files.length > 0 && (
            <div className="col col--g3">
              {files.map((f, i) => (
                <FileRow
                  key={i}
                  name={f.name}
                  tone="ai"
                  size={f.file?.size ? formatBytes(f.file.size) : null}
                  action={(
                    <IconBtn
                      icon="close"
                      tone="danger"
                      size="sm"
                      onClick={() => removeFile(i)}
                      ariaLabel={t('event.ai_remove_file')}
                    />
                  )}
                />
              ))}
            </div>
          )}

          {/* Поле + ряд действий в общей рамке: вертикальный вариант группы (TRIP-333). */}
          <InputGroup className="ai-input">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={dragOver ? t('event.ai_drop_active') : t('event.ai_textarea_ph')}
            />
            <div className="ai-input-row">
              <Btn variant="secondary" icon="upload" onClick={() => inputRef.current?.click()}>
                {t('event.ai_pdf_screenshot')}
              </Btn>
              <span className="ai-blk-hint">{t('event.ai_drop_idle')}</span>
              <div className="grow" />
              <Btn variant="ai" onClick={runParse} disabled={!text.trim() && files.length === 0}>
                <Sparkles style={{ width: 13, height: 13, marginRight: 5 }} />{t('event.ai_recognize_booking')}
              </Btn>
            </div>
          </InputGroup>

          {error && (
            <div className="err" style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <X style={{ width: 13, height: 13, marginTop: 1, flexShrink: 0 }} />{error}
            </div>
          )}

          <input
            ref={inputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            accept={PARSER_ACCEPT}
            onChange={(e) => { addFiles(e.target.files); if (inputRef.current) inputRef.current.value = ''; }}
          />
          </div>
        </div>
      </div>
    </Card>
  );
}

function pluralFields(t, n) {
  if (n % 10 === 1 && n % 100 !== 11) return t('event.field_one');
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return t('event.field_few');
  return t('event.field_many');
}

