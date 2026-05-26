import React, { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { Loader2, Upload, Sparkles, X, FileText, Link2, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { detectPlatformFromUrl } from '@/lib/booking-platforms';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

const MAX_AI_FILES = 3;

const EXTRACT_SCHEMA = {
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

// The LLM otherwise defaults to its training-data year (e.g. 2024) when the
// voucher omits the year. We inject the real current year so the dialog
// pre-fills the right one.
const CURRENT_YEAR = new Date().getFullYear();
const TODAY_ISO = new Date().toISOString().slice(0, 10);

const PROMPT_BASE = `You are extracting hotel booking data from one or more confirmation files (PDF / image). The files belong to the SAME single booking — merge any extra info you find. Return ONLY fields you can confidently read. Leave unknown fields empty. Detect the booking platform from logos/headers/footers/URLs. Times in 24h format. Currency as ISO 4217.

DATE/YEAR RULES (very important):
- Today's date is ${TODAY_ISO} (current year = ${CURRENT_YEAR}). Use this as the reference for resolving any ambiguous dates.
- If a date in the document does NOT include a year, assume the current year (${CURRENT_YEAR}).
- If that resulting date is already in the PAST (earlier than today), advance the year by 1 (use ${CURRENT_YEAR + 1} instead) — bookings are for the future, not the past.
- If a year IS explicitly written in the document, always honor it as-is (even if it's in the past — the user may be archiving an old booking).`;

export default function HotelAiUpload({ onExtract, onCancel }) {
  const { t, plural } = useI18nFormat();
  const [files, setFiles] = useState([]);
  const [url, setUrl] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [stage, setStage] = useState('idle');
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  const runLlm = async ({ fileUrls, urlForPrompt }) => {
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: urlForPrompt
        ? `${PROMPT_BASE}\n\nAlso parse this booking URL and extract any visible data from it (host, booking reference in query params, etc.): ${urlForPrompt}`
        : PROMPT_BASE,
      file_urls: fileUrls,
      response_json_schema: EXTRACT_SCHEMA,
      add_context_from_internet: !!urlForPrompt,
      model: 'gemini_3_flash',
    });
    if (!result.booking_platform && result.booking_url) {
      const p = detectPlatformFromUrl(result.booking_url);
      if (p) result.booking_platform = p;
    }
    if (!result.booking_url && urlForPrompt) result.booking_url = urlForPrompt;
    if (!result.booking_platform && urlForPrompt) {
      const p = detectPlatformFromUrl(urlForPrompt);
      if (p) result.booking_platform = p;
    }
    return result;
  };

  const addLocalFiles = (list) => {
    if (!list?.length) return;
    setError(null);
    setStage('idle');
    const incoming = Array.from(list).filter(f => {
      if (f.size > 5 * 1024 * 1024) {
        setError(t('ai.file_too_large', { name: f.name }));
        return false;
      }
      return true;
    });
    if (!incoming.length) return;
    setFiles(prev => {
      const available = MAX_AI_FILES - prev.length;
      const toAdd = incoming.slice(0, available).map(f => ({ file: f, status: 'pending', name: f.name }));
      if (incoming.length > available) {
        setError(t('ai.too_many_files', { max: MAX_AI_FILES }));
      }
      return [...prev, ...toAdd];
    });
  };

  const removeAt = (idx) => {
    setFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const analyzeFiles = async () => {
    if (files.length === 0) return;
    setError(null);
    setStage('analyzing');
    try {
      const uploaded = await Promise.all(
        files.map(async (f) => {
          if (f.file_url) return f;
          const { file_url } = await base44.integrations.Core.UploadFile({ file: f.file });
          return { ...f, file_url, status: 'uploaded' };
        })
      );
      setFiles(uploaded);
      const fileUrls = uploaded.map(f => f.file_url);
      const result = await runLlm({ fileUrls });
      const documents = uploaded.map(u => ({ file_url: u.file_url, file_name: u.name }));
      onExtract({ ...result, documents }, documents[0]?.file_url || null, documents[0]?.file_name || null);
    } catch (e) {
      setError(e?.message || t('ai.error_files'));
      setStage('error');
    }
  };

  const handleUrl = async () => {
    if (!url.trim()) return;
    setError(null);
    setStage('analyzing');
    try {
      const result = await runLlm({ fileUrls: [], urlForPrompt: url.trim() });
      onExtract({ ...result, documents: [] }, null, null);
    } catch (e) {
      setError(e?.message || t('ai.error_link'));
      setStage('error');
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    addLocalFiles(e.dataTransfer.files);
  };

  const busy = stage === 'analyzing';
  const canAddMore = files.length < MAX_AI_FILES;

  return (
    <>
      <div className="rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 via-primary/[0.02] to-accent/5 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-primary" />
            <h3 className="font-medium text-sm">{t('ai.hotel_title')}</h3>
            <button onClick={onCancel} className="ml-auto p-1 rounded hover:bg-secondary" aria-label={t('ai.aria_close')}>
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <Link2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder={t('ai.hotel_url_placeholder')}
                className="pl-9"
                disabled={busy}
                onKeyDown={e => e.key === 'Enter' && handleUrl()}
              />
            </div>
            <Button type="button" onClick={handleUrl} disabled={busy || !url.trim()}>
              {busy && files.length === 0 ? <Loader2 className="w-4 h-4 animate-spin" /> : t('ai.analyze')}
            </Button>
          </div>

          <div className="flex items-center gap-2 my-2 text-xs text-muted-foreground">
            <div className="flex-1 h-px bg-border" />{t('ai.or')}<div className="flex-1 h-px bg-border" />
          </div>

          {files.length > 0 && (
            <ul className="space-y-1.5 mb-2">
              {files.map((f, i) => (
                <li key={i} className="flex items-center gap-2 p-2 rounded-md bg-card border min-w-0">
                  <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-sm flex-1 truncate min-w-0">{f.name}</span>
                  {!busy && (
                    <button
                      type="button"
                      onClick={() => removeAt(i)}
                      className="p-1 rounded hover:bg-secondary shrink-0"
                      aria-label={t('ai.aria_delete')}
                    >
                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canAddMore && (
            <div
              onClick={() => !busy && inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`cursor-pointer rounded-lg border-2 border-dashed transition p-4 text-center
                ${dragOver ? 'border-primary bg-primary/10' : 'border-border bg-card'}
                ${busy ? 'pointer-events-none opacity-70' : 'hover:border-primary/60'}`}
            >
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                accept=".pdf,image/png,image/jpeg,image/jpg,image/webp"
                onChange={e => { addLocalFiles(e.target.files); if (inputRef.current) inputRef.current.value = ''; }}
              />
              {files.length === 0 ? (
                <>
                  <div className="mx-auto w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                    <Upload className="w-4 h-4 text-primary" />
                  </div>
                  <div className="text-sm font-medium">{t('ai.drop_files')}</div>
                  <div className="text-xs text-muted-foreground mt-1">{t('ai.formats_hint', { max: MAX_AI_FILES })}</div>
                </>
              ) : (
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Plus className="w-4 h-4" />
                  {t('ai.add_more', { remaining: MAX_AI_FILES - files.length })}
                </div>
              )}
            </div>
          )}

          {busy && (
            <div className="flex items-center justify-center gap-2 text-sm text-primary py-3">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('ai.analyzing_hotel')}
            </div>
          )}
          {stage === 'error' && error && (
            <div className="text-sm text-destructive mt-2 flex items-start gap-2">
              <FileText className="w-4 h-4 mt-0.5 shrink-0" />{error}
            </div>
          )}
          {error && stage !== 'error' && (
            <div className="text-xs text-amber-700 dark:text-amber-300 mt-2">{error}</div>
          )}

          {files.length > 0 && !busy && (
            <div className="mt-3 flex justify-end">
              <Button type="button" onClick={analyzeFiles}>
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                {plural(files.length, 'ai.recognize_files').replace('{count}', files.length)}
              </Button>
            </div>
          )}
      </div>
    </>
  );
}