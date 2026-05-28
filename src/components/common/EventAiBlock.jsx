/**
 * EventAiBlock — unified "parse a booking with AI" widget for the event edit
 * dialog. Renders six visual states from the designer's prototype:
 *
 *   locked    — non-Pro users: locked card + upgrade CTA
 *   available — collapsed pill (Pro idle)
 *   idle      — textarea + file upload + recognize CTA
 *   uploaded  — file list + recognize CTA
 *   parsing   — spinner + progress
 *   parsed    — success banner + reset
 *
 * The LLM schemas + prompts for `hotel` and `transfer` (the two kinds that
 * have a parser today) are inlined here so the previous
 * HotelAiUpload / TransferAiUpload files can be retired.
 *
 * `onExtract(data, fileUrl, fileName)` is called with the parsed JSON
 * (already wrapped per-kind: hotel → flat field shape, transfer → segments
 * shape with documents). Parent maps the values into its form.
 */
import React, { useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { detectPlatformFromUrl } from '@/lib/booking-platforms';
import {
  Sparkles, Lock, Loader2, Upload, X, FileText, Image as ImageIcon, Edit3,
  RefreshCw, ChevronUp,
} from 'lucide-react';

const MAX_FILES = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

// ── Schemas ─────────────────────────────────────────────────────────────────

const HOTEL_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    address: { type: 'string' },
    check_in_date: { type: 'string', description: 'YYYY-MM-DD' },
    check_in_time: { type: 'string', description: 'HH:mm 24h' },
    check_out_date: { type: 'string', description: 'YYYY-MM-DD' },
    check_out_time: { type: 'string', description: 'HH:mm 24h' },
    booking_reference: { type: 'string' },
    payment_status: { type: 'string', enum: ['paid', 'partial', 'pay_on_arrival'] },
    price: { type: 'number' },
    currency: { type: 'string', description: 'ISO 4217 code (EUR, USD, etc.)' },
    free_cancellation: { type: 'boolean' },
    free_cancellation_until: { type: 'string', description: 'YYYY-MM-DD HH:mm if known' },
    phone: { type: 'string' },
    email: { type: 'string' },
    booking_url: { type: 'string' },
    booking_platform: {
      type: 'string',
      enum: ['booking', 'airbnb', 'hotels', 'expedia', 'agoda', 'trivago', 'vrbo', 'other'],
    },
  },
};

const TRANSFER_SEGMENT_SCHEMA = {
  type: 'object',
  properties: {
    transport_type: { type: 'string', enum: ['plane', 'train', 'bus', 'car', 'taxi', 'ferry', 'other'] },
    departure_date: { type: 'string', description: 'YYYY-MM-DD' },
    departure_time: { type: 'string', description: 'HH:mm 24h' },
    arrival_date: { type: 'string', description: 'YYYY-MM-DD' },
    arrival_time: { type: 'string', description: 'HH:mm 24h' },
    carrier: { type: 'string' },
    booking_reference: { type: 'string' },
    from_address: { type: 'string' },
    to_address: { type: 'string' },
    price: { type: 'number' },
    currency: { type: 'string' },
  },
};

const TRANSFER_SCHEMA = {
  type: 'object',
  properties: {
    booking_url: { type: 'string' },
    booking_platform: { type: 'string' },
    segments: { type: 'array', items: TRANSFER_SEGMENT_SCHEMA },
  },
};

// ── Prompts ─────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();
const TODAY_ISO = new Date().toISOString().slice(0, 10);

const HOTEL_PROMPT = `You are extracting hotel booking data from one or more confirmation files (PDF / image). The files belong to the SAME single booking — merge any extra info you find. Return ONLY fields you can confidently read. Leave unknown fields empty. Detect the booking platform from logos/headers/footers/URLs. Times in 24h format. Currency as ISO 4217.

DATE/YEAR RULES:
- Today's date is ${TODAY_ISO} (current year = ${CURRENT_YEAR}).
- If a date in the document does NOT include a year, assume the current year (${CURRENT_YEAR}).
- If that resulting date is already in the PAST, advance the year by 1 (use ${CURRENT_YEAR + 1}).
- If a year IS explicitly written, honor it as-is.`;

const TRANSFER_PROMPT = `You are extracting transport booking data (flight / train / bus / ferry / boarding pass / e-ticket) from one or more files. The files belong to the SAME single booking — merge across them.

CRITICAL — MULTI-SEGMENT (LAYOVERS / CONNECTIONS):
A booking can contain MULTIPLE legs with intermediate stops. Return EACH physical leg as a separate item in the segments array, in chronological order, with its OWN from_address, to_address, departure & arrival times.

VERIFICATION RULE: For every pair of consecutive segments, segments[i+1].from_address MUST equal segments[i].to_address.

If the booking is direct, return exactly ONE segment.

Common fields (booking_url, booking_platform) go at the top level. Carrier may differ per leg (codeshare); fill carrier per-segment. For total price, if only a grand total is shown, put it on the FIRST segment.

Return ONLY fields you can confidently read. Leave unknown fields empty. Detect platform from logos/headers/footers/URLs. Times in 24h format. Currency as ISO 4217. For airports/stations include the IATA/station code + city (e.g. "Madrid (MAD) Terminal 1").

DATE/YEAR RULES:
- Today's date is ${TODAY_ISO} (current year = ${CURRENT_YEAR}).
- Missing year → assume ${CURRENT_YEAR}; if that's in the past, use ${CURRENT_YEAR + 1}.
- Explicit year → honor it.`;

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
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]); // { file, name, file_url? }
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef(null);
  const animRef = useRef(null);

  const schema = kind === 'transfer' ? TRANSFER_SCHEMA : HOTEL_SCHEMA;
  const prompt = kind === 'transfer' ? TRANSFER_PROMPT : HOTEL_PROMPT;

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
        setError(`Файл «${f.name}» слишком большой (макс. 5 МБ).`);
        return false;
      }
      return true;
    });
    if (!incoming.length) return;
    setFiles((prev) => {
      const space = MAX_FILES - prev.length;
      const toAdd = incoming.slice(0, space).map((f) => ({ file: f, name: f.name }));
      if (incoming.length > space) setError(`Можно загрузить максимум ${MAX_FILES} файлов.`);
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

  // The LLM call — uploads any local files, then invokes the parser.
  const runParse = async () => {
    setError(null);
    setState('parsing');
    startFakeProgress();
    try {
      const uploaded = await Promise.all(files.map(async (f) => {
        if (f.file_url) return f;
        const { file_url } = await base44.integrations.Core.UploadFile({ file: f.file });
        return { ...f, file_url };
      }));
      const fileUrls = uploaded.map((f) => f.file_url).filter(Boolean);
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: text.trim() ? `${prompt}\n\nAlso extract from this user-provided text:\n${text.trim()}` : prompt,
        file_urls: fileUrls,
        response_json_schema: schema,
        add_context_from_internet: false,
        model: 'gemini_3_flash',
      });
      if (!result.booking_platform && result.booking_url) {
        const p = detectPlatformFromUrl(result.booking_url);
        if (p) result.booking_platform = p;
      }
      if (kind === 'transfer' && (!Array.isArray(result.segments) || result.segments.length === 0)) {
        result.segments = [{}];
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
      setError(e?.message || 'Не удалось распознать. Попробуй ещё раз.');
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
            Доступно на Pro · вставь текст или загрузи файл — поля заполнятся сами.
          </div>
        </div>
        <Button size="sm" onClick={onUpgrade} className="bg-gradient-to-r from-primary via-chart-1 to-chart-3">
          <Sparkles className="w-3.5 h-3.5 mr-1.5" />Перейти к Pro
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
            Вставь текст подтверждения или загрузи файл — поля заполнятся сами.
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
            background: 'linear-gradient(135deg, #6a3ee2, #c66ce2)', color: 'white',
            display: 'grid', placeItems: 'center', flexShrink: 0,
          }}
        >
          <Sparkles className="w-5 h-5" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="text-sm font-semibold flex items-center gap-1.5">
            ИИ читает подтверждение бронирования
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          </div>
          {files[0]?.name && (
            <div className="text-xs text-muted-foreground mt-0.5 truncate">{files[0].name}</div>
          )}
          <div className="h-1 rounded mt-2 overflow-hidden" style={{ background: 'var(--ai-soft-12)' }}>
            <div
              className="h-full transition-all"
              style={{ width: `${progress}%`, background: 'linear-gradient(90deg, var(--ai), #c66ce2)' }}
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
          <div className="text-sm font-semibold">ИИ заполнил {parsedFieldCount} {pluralFields(parsedFieldCount)}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Подсвечены фиолетовым. Любое поле можно поправить — пометка ИИ уйдёт.
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { onReset?.(); setText(''); setFiles([]); setState('idle'); }}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />Сбросить
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setState('available')}
          aria-label="Свернуть"
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
              ? `${files.length} ${files.length === 1 ? 'файл готов' : 'файла готовы'} к распознаванию`
              : 'Вставь текст подтверждения или скриншот — поля заполнятся сами.'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setState('available')}
          title="Свернуть"
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
                  <div className="text-[11px] text-muted-foreground">{formatSize(f.file.size)}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="w-7 h-7 rounded grid place-items-center text-muted-foreground hover:bg-secondary"
                aria-label="Убрать файл"
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
              <Upload className="w-3 h-3 inline-block mr-1.5 mb-0.5" />Добавить ещё файл
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
            placeholder="Вставь сюда текст письма с подтверждением, номер брони, ссылку…"
            style={{ minHeight: 84 }}
          />
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
              <Upload className="w-3.5 h-3.5 mr-1.5" />PDF / скриншот
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {dragOver ? 'Брось файл сюда…' : 'или перетащи файл сюда'}
            </span>
            <div className="flex-1" />
            <Button
              size="sm"
              onClick={runParse}
              disabled={!text.trim() && files.length === 0}
              style={{ background: 'var(--ai)', borderColor: 'var(--ai)' }}
              className="text-white hover:opacity-90"
            >
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />Распознать
            </Button>
          </div>
        </div>
      )}

      {state === 'uploaded' && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => setState('idle')}>
            <Edit3 className="w-3.5 h-3.5 mr-1.5" />+ вставить текст
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            onClick={runParse}
            style={{ background: 'var(--ai)', borderColor: 'var(--ai)' }}
            className="text-white hover:opacity-90"
          >
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />Распознать бронь
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
        background: 'linear-gradient(135deg, #6a3ee2, #c66ce2)', color: 'white',
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
  return (
    <div className="text-sm font-semibold flex items-center gap-1.5 flex-wrap">
      Заполнить через ИИ
      <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Pro</span>
    </div>
  );
}

function pluralFields(n) {
  if (n % 10 === 1 && n % 100 !== 11) return 'поле';
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'поля';
  return 'полей';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
