/**
 * EventAiBlock - unified "parse a booking with AI" widget for the event edit
 * dialog. Renders six visual states from the designer's prototype:
 *
 *   locked    - non-Pro users: locked card + upgrade CTA
 *   available - collapsed pill (Pro idle)
 *   idle      - textarea + file upload + recognize CTA
 *   uploaded  - file list + recognize CTA
 *   parsing   - spinner + progress
 *   parsed    - success banner + reset
 *
 * Recognition runs server-side: the browser uploads the file(s) to Supabase
 * Storage, then calls the `parseBookingWithAi` edge function with
 * { kind, fileUrls }. That function forwards to the n8n webhook, which holds
 * the per-kind prompts + schemas and runs the LLM (Gemini). We only send
 * `kind` and the file URLs - no prompt/schema travels from the client.
 *
 * `onExtract(data, fileUrl, fileName)` is called with the parsed JSON
 * (hotel → flat field shape, transfer → segments shape) plus the uploaded
 * documents. Parent maps the values into its form.
 */
import React, { useRef, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useI18n } from '@/lib/i18n/I18nContext';
import { safeStorageName } from '@/lib/storage';
import { Button } from '@/components/ui/button';
import { detectPlatformFromUrl } from '@/lib/booking-platforms';
import {
  Sparkles, Lock, Loader2, Upload, X, FileText, Image as ImageIcon, Edit3,
  RefreshCw, ChevronUp,
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
  const [progress, setProgress] = useState(0);
  const inputRef = useRef(null);
  const animRef = useRef(null);

  const startFakeProgress = () => {
    setProgress(0);
    let p = 0;
    const tick = () => {
      p = Math.min(85, p + Math.random() * 12 + 3);
      setProgress(p);
      animRef.current = setTimeout(tick, 350);
    };
    tick();
  };
  const stopFakeProgress = () => {
    if (animRef.current) { clearTimeout(animRef.current); animRef.current = null; }
  };

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
    startFakeProgress();
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

      // Peel any n8n wrappers (array / { output } / { kind, data } / …) down to
      // the object that actually holds the booking fields.
      const result = extractBookingPayload(invoked);

      // New transfer shape = result.transfers[] (legs) + result.waypoints[]
      // (layover cities). Older shape used result.segments[]. Pick whichever
      // the model returned and normalise transport_type synonyms ("flight"→"plane").
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
      // Empty fallback only when the model returned NO legs at all.
      if (kind === 'transfer' && !legs) {
        result.transfers = [{}];
      }
      const documents = uploaded
        .filter((u) => u.file_url)
        .map((u) => ({ file_url: u.file_url, file_name: u.name }));
      stopFakeProgress();
      setProgress(100);
      onExtract(
        { ...result, documents },
        documents[0]?.file_url || null,
        documents[0]?.file_name || null,
      );
    } catch (e) {
      stopFakeProgress();
      setError(e?.message || t('event.ai_parse_error'));
      setState('uploaded');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (state === 'locked') {
    return (
      <div
        className="mb-4 rounded-xl border"
        style={{
          position: 'relative', padding: '14px 16px',
          background: 'linear-gradient(135deg, var(--ai-soft) 0%, rgba(240,164,90,.05) 100%)',
          borderColor: 'var(--ai-soft-12)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}
      >
        <AiIcon locked />
        <div style={{ flex: 1, minWidth: 200 }}>
          <Title />
          <div className="text-xs text-muted-foreground mt-0.5">
            {t('event.ai_locked_hint')}
          </div>
        </div>
        <Button size="sm" onClick={onUpgrade} className="bg-gradient-to-r from-primary via-chart-1 to-chart-3">
          <Sparkles className="w-3.5 h-3.5 mr-1.5" />{t('trips.go_pro')}
        </Button>
      </div>
    );
  }

  if (state === 'available') {
    return (
      <button
        type="button"
        onClick={() => setState('idle')}
        className="mb-4 w-full text-left rounded-xl border transition"
        style={{
          padding: '12px 16px',
          background: 'linear-gradient(135deg, var(--ai-soft) 0%, rgba(240,164,90,.06) 100%)',
          borderColor: 'var(--ai-soft-12)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}
      >
        <AiIcon />
        <div style={{ flex: 1, minWidth: 180 }}>
          <Title />
          <div className="text-xs text-muted-foreground mt-0.5">
            {t('event.ai_available_hint')}
          </div>
        </div>
      </button>
    );
  }

  if (state === 'parsing') {
    return (
      <div
        className="mb-4 rounded-xl border"
        style={{
          padding: 18,
          background: 'var(--ai-soft)',
          borderColor: 'var(--ai-soft-12)',
          display: 'flex', alignItems: 'center', gap: 14,
        }}
      >
        <div
          style={{
            width: 40, height: 40, borderRadius: 10,
            background: 'var(--ai-grad)', color: 'white',
            display: 'grid', placeItems: 'center', flexShrink: 0,
          }}
        >
          <Sparkles className="w-5 h-5" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="text-sm font-semibold flex items-center gap-1.5">
            {t('event.ai_parsing')}
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          </div>
          {files[0]?.name && (
            <div className="text-xs text-muted-foreground mt-0.5 truncate">{files[0].name}</div>
          )}
          <div className="h-1 rounded mt-2 overflow-hidden" style={{ background: 'var(--ai-soft-12)' }}>
            <div
              className="h-full transition-all"
              style={{ width: `${progress}%`, background: 'linear-gradient(90deg, var(--ai), var(--ai-2))' }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (state === 'parsed') {
    return (
      <div
        className="mb-4 rounded-xl border"
        style={{
          padding: '12px 16px',
          background: 'rgba(31,138,91,.10)',
          borderColor: 'var(--success)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'var(--success)', color: 'white',
            display: 'grid', placeItems: 'center', flexShrink: 0,
          }}
        >
          <Sparkles className="w-4 h-4" />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="text-sm font-semibold">{t('event.ai_filled', { count: parsedFieldCount, fields: pluralFields(t, parsedFieldCount) })}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {t('event.ai_highlighted_hint')}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { onReset?.(); setText(''); setFiles([]); setState('idle'); }}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />{t('event.ai_reset')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setState('available')}
          aria-label={t('common.less')}
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </Button>
      </div>
    );
  }

  // idle / uploaded
  return (
    <div
      className="mb-4 rounded-xl border"
      style={{
        padding: 18,
        background: 'linear-gradient(135deg, var(--ai-soft) 0%, rgba(240,164,90,.06) 100%)',
        borderColor: 'var(--ai-soft-12)',
      }}
    >
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <AiIcon />
        <div style={{ flex: 1, minWidth: 200 }}>
          <Title />
          <div className="text-xs text-muted-foreground mt-0.5">
            {state === 'uploaded'
              ? `${files.length} ${files.length === 1 ? t('event.ai_file_ready_one') : t('event.ai_file_ready_many')} ${t('event.ai_files_ready_suffix')}`
              : t('event.ai_paste_hint')}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setState('available')}
          title={t('common.less')}
          className="w-7 h-7 rounded-md grid place-items-center text-muted-foreground hover:bg-white/40 transition"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Files */}
      {files.length > 0 && (
        <div className="flex flex-col gap-1.5 mb-3">
          {files.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-2.5 rounded-lg border bg-background px-2.5 py-2"
              style={{ borderColor: 'var(--ai-soft-12)' }}
            >
              <div
                className="w-7 h-7 rounded grid place-items-center shrink-0"
                style={{ background: 'var(--ai-soft)', color: 'var(--ai)' }}
              >
                {/\.(png|jpe?g|gif|webp|svg)$/i.test(f.name) ? (
                  <ImageIcon className="w-3.5 h-3.5" />
                ) : (
                  <FileText className="w-3.5 h-3.5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{f.name}</div>
                {f.file?.size && (
                  <div className="text-[length:var(--fs-micro)] text-muted-foreground">{formatSize(f.file.size)}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="w-7 h-7 rounded grid place-items-center text-muted-foreground hover:bg-secondary"
                aria-label={t('event.ai_remove_file')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {files.length < MAX_FILES && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-lg border-2 border-dashed py-1.5 text-center text-xs text-muted-foreground hover:bg-white/40 transition"
              style={{ borderColor: 'var(--ai-soft-12)' }}
            >
              <Upload className="w-3 h-3 inline-block mr-1.5 mb-0.5" />{t('event.ai_add_more')}
            </button>
          )}
        </div>
      )}

      {/* Idle text+upload area */}
      {state === 'idle' && (
        <div
          className="rounded-lg border bg-background"
          style={{ borderColor: 'var(--ai-soft-12)', padding: 10 }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        >
          <textarea
            className="w-full bg-transparent text-sm resize-vertical outline-none p-1.5"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('event.ai_textarea_ph')}
            style={{ minHeight: 84 }}
          />
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
              <Upload className="w-3.5 h-3.5 mr-1.5" />{t('event.ai_pdf_screenshot')}
            </Button>
            <span className="text-[length:var(--fs-micro)] text-muted-foreground">
              {dragOver ? t('event.ai_drop_active') : t('event.ai_drop_idle')}
            </span>
            <div className="flex-1" />
            <Button
              size="sm"
              onClick={runParse}
              disabled={!text.trim() && files.length === 0}
              style={{ background: 'var(--ai)', borderColor: 'var(--ai)' }}
              className="text-white hover:opacity-90"
            >
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />{t('event.ai_recognize')}
            </Button>
          </div>
        </div>
      )}

      {state === 'uploaded' && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => setState('idle')}>
            <Edit3 className="w-3.5 h-3.5 mr-1.5" />{t('event.ai_paste_text')}
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            onClick={runParse}
            style={{ background: 'var(--ai)', borderColor: 'var(--ai)' }}
            className="text-white hover:opacity-90"
          >
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />{t('event.ai_recognize_booking')}
          </Button>
        </div>
      )}

      {error && (
        <div className="mt-2 text-xs text-destructive flex items-start gap-1.5">
          <X className="w-3.5 h-3.5 mt-0.5 shrink-0" />{error}
        </div>
      )}

      {/* Hidden file input shared by all upload triggers */}
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        accept=".pdf,image/*"
        onChange={(e) => { addFiles(e.target.files); if (inputRef.current) inputRef.current.value = ''; }}
      />
    </div>
  );
}

function AiIcon({ locked }) {
  return (
    <div
      className="relative shrink-0"
      style={{
        width: 32, height: 32, borderRadius: 8,
        background: 'var(--ai-grad)', color: 'white',
        display: 'grid', placeItems: 'center',
        filter: locked ? 'saturate(.7)' : 'none',
      }}
    >
      <Sparkles className="w-4 h-4" />
      {locked && (
        <span
          className="absolute grid place-items-center"
          style={{
            bottom: -3, right: -3,
            width: 18, height: 18, borderRadius: '50%',
            background: 'var(--ai)', color: 'white',
            border: '2px solid var(--background, white)',
          }}
        >
          <Lock className="w-2.5 h-2.5" />
        </span>
      )}
    </div>
  );
}

function Title() {
  const { t } = useI18n();
  return (
    <div className="text-sm font-semibold flex items-center gap-1.5 flex-wrap">
      {t('event.ai_fill_title')}
      <span className="text-[length:var(--fs-nano)] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Pro</span>
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
