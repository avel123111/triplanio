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
import { supabase } from '@/api/supabaseClient';
import { useI18n } from '@/lib/i18n/I18nContext';
import { safeStorageName } from '@/lib/storage';
import { detectPlatformFromUrl } from '@/lib/booking-platforms';
import {
  Sparkles, Lock, Loader2, Upload, X, FileText, Image as ImageIcon,
  RefreshCw, ChevronUp, ChevronDown, Check,
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
  const isBooking = ['transfers', 'waypoints', 'segments', 'name', 'from_address', 'check_in_date', 'booking_platform', 'booking_reference', 'booking_url']
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
    try {
      // 1. Upload local files to Storage → long-lived signed URLs.
      const uploaded = await Promise.all(files.map(async (f) => {
        if (f.file_url) return f;
        const uid = (crypto?.randomUUID?.()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        // Supabase Storage keys reject non-ASCII / special chars (Cyrillic
        // filenames → "Invalid key"). Sanitise the path; keep the real name for
        // display via `documents` below.
        const path = `ai-uploads/${uid}/${safeStorageName(f.name)}`;
        const { error: upErr } = await supabase.storage.from('documents').upload(path, f.file);
        if (upErr) throw new Error(upErr.message || t('event.ai_upload_error'));
        const { data: urlData } = await supabase.storage.from('documents').createSignedUrl(path, 315360000);
        return { ...f, file_url: urlData?.signedUrl || '', storage_path: path };
      }));
      const fileUrls = uploaded.map((f) => f.file_url).filter(Boolean);

      // 2. Call the edge function. kind + fileUrls + the pasted text all go to
      //    n8n (prompts and schemas live inside the n8n workflow).
      const body = { kind, fileUrls, text: text.trim() };
      const { data: invoked, error: invokeErr } = await supabase.functions.invoke('parseBookingWithAi', { body });
      if (invokeErr) throw invokeErr;
      if (invoked?.error) throw new Error(invoked.error);

      const result = extractBookingPayload(invoked);

      // New transfer shape = result.transfers[] (legs) + result.waypoints[].
      // Older shape used result.segments[]. Normalise transport_type synonyms.
      const legs = kind === 'transfer'
        ? (Array.isArray(result.transfers) ? result.transfers
          : (Array.isArray(result.segments) ? result.segments : null))
        : null;
      if (legs) {
        const TT = { flight: 'plane', air: 'plane', airplane: 'plane', rail: 'train', boat: 'ferry', shuttle: 'bus' };
        legs.forEach((s) => { if (s && TT[s.transport_type]) s.transport_type = TT[s.transport_type]; });
      }
      if (!result.booking_platform && result.booking_url) {
        const p = detectPlatformFromUrl(result.booking_url);
        if (p) result.booking_platform = p;
      }
      if (kind === 'transfer' && !legs) result.transfers = [{}];

      const documents = uploaded
        .filter((u) => u.file_url)
        .map((u) => ({ file_url: u.file_url, file_name: u.name }));
      onExtract(
        { ...result, documents },
        documents[0]?.file_url || null,
        documents[0]?.file_name || null,
      );
    } catch (e) {
      setError(e?.message || t('event.ai_parse_error'));
      setState('uploaded');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  const ProPill = () => <span className="pro-pill">Pro</span>;
  const titleEl = <b>{t('event.ai_fill_title')}<ProPill /></b>;

  if (state === 'locked') {
    return (
      <div className="ai-blk locked">
        <div className="ai-blk-hd">
          <div className="ai-blk-ic"><Lock style={{ width: 16, height: 16, color: '#fff' }} /></div>
          <div className="ai-blk-ti">{titleEl}<span>{t('event.ai_locked_hint')}</span></div>
          <button type="button" className="btn btn--sm" style={{ background: 'var(--pro-gradient)', color: 'var(--pro-fg)', border: 0 }} onClick={onUpgrade}>
            <Sparkles style={{ width: 13, height: 13, marginRight: 5 }} />{t('trips.go_pro')}
          </button>
        </div>
      </div>
    );
  }

  if (state === 'available') {
    return (
      <button type="button" className="ai-blk" onClick={() => setState('idle')} style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}>
        <div className="ai-blk-hd">
          <div className="ai-blk-ic"><Sparkles style={{ width: 16, height: 16, color: '#fff' }} /></div>
          <div className="ai-blk-ti">{titleEl}<span>{t('event.ai_available_hint')}</span></div>
          <ChevronDown style={{ width: 16, height: 16, color: 'var(--muted)', flexShrink: 0 }} />
        </div>
      </button>
    );
  }

  if (state === 'parsing') {
    return (
      <div className="ai-blk">
        <div className="ai-blk-hd">
          <div className="ai-blk-ic"><Loader2 style={{ width: 16, height: 16, color: '#fff', animation: 'spin .8s linear infinite' }} /></div>
          <div className="ai-blk-ti"><b>{t('event.ai_parsing')}</b>{files[0]?.name && <span>{files[0].name}</span>}</div>
        </div>
        <div className="ai-blk-body"><div className="ai-prog"><div className="ai-prog-fill" /></div></div>
      </div>
    );
  }

  if (state === 'parsed') {
    return (
      <div className="ai-blk parsed">
        <div className="ai-blk-hd">
          <div className="ai-blk-ic"><Check style={{ width: 16, height: 16, color: '#fff' }} /></div>
          <div className="ai-blk-ti">
            <b>{t('event.ai_filled', { count: parsedFieldCount, fields: pluralFields(t, parsedFieldCount) })}</b>
            <span>{t('event.ai_highlighted_hint')}</span>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => { onReset?.(); setText(''); setFiles([]); setState('idle'); }}>
            <RefreshCw style={{ width: 13, height: 13, marginRight: 5 }} />{t('event.ai_reset')}
          </button>
        </div>
      </div>
    );
  }

  // idle / uploaded
  return (
    <div className="ai-blk">
      <div className="ai-blk-hd" role="button" tabIndex={0} onClick={() => setState('available')} style={{ cursor: 'pointer' }}>
        <div className="ai-blk-ic"><Sparkles style={{ width: 16, height: 16, color: '#fff' }} /></div>
        <div className="ai-blk-ti">
          {titleEl}
          <span>{state === 'uploaded'
            ? `${files.length} ${files.length === 1 ? t('event.ai_file_ready_one') : t('event.ai_file_ready_many')} ${t('event.ai_files_ready_suffix')}`
            : t('event.ai_paste_hint')}</span>
        </div>
        <ChevronUp style={{ width: 16, height: 16, color: 'var(--muted)', flexShrink: 0 }} />
      </div>

      <div className="ai-blk-body"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
      >
        {files.length > 0 && (
          <div className="gy">
            {files.map((f, i) => (
              <div key={i} className="doc-row" style={{ cursor: 'default' }}>
                <div className="di">{/\.(png|jpe?g|gif|webp|svg)$/i.test(f.name) ? <ImageIcon style={{ width: 13, height: 13 }} /> : <FileText style={{ width: 13, height: 13 }} />}</div>
                <b>{f.name}</b>
                {f.file?.size && <span className="ds">{formatSize(f.file.size)}</span>}
                <button type="button" onClick={() => removeFile(i)} aria-label={t('event.ai_remove_file')}
                  style={{ background: 'transparent', border: 0, color: 'var(--muted)', cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <X style={{ width: 14, height: 14 }} />
                </button>
              </div>
            ))}
          </div>
        )}

        {state === 'idle' && (
          <textarea
            className="textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={dragOver ? t('event.ai_drop_active') : t('event.ai_textarea_ph')}
            style={{ minHeight: 56 }}
          />
        )}

        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--ai btn--sm" onClick={runParse} disabled={!text.trim() && files.length === 0}>
            <Sparkles style={{ width: 13, height: 13, marginRight: 5 }} />{t('event.ai_recognize')}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => inputRef.current?.click()}>
            <Upload style={{ width: 13, height: 13, marginRight: 5 }} />{t('event.ai_pdf_screenshot')}
          </button>
        </div>

        {error && (
          <div className="err" style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <X style={{ width: 13, height: 13, marginTop: 1, flexShrink: 0 }} />{error}
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        accept=".pdf,image/*"
        onChange={(e) => { addFiles(e.target.files); if (inputRef.current) inputRef.current.value = ''; }}
      />
    </div>
  );
}

function pluralFields(t, n) {
  if (n % 10 === 1 && n % 100 !== 11) return t('event.field_one');
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return t('event.field_few');
  return t('event.field_many');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
