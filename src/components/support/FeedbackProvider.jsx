import React, { createContext, useContext, useState, useCallback, useMemo, useRef } from 'react';
import { Btn, Dialog, Field, FileRow, Grow, IconBtn, Card, Textarea, useToast } from '@/design/index';
import { Icon } from '@/design/icons';
import { useI18n } from '@/lib/i18n/I18nContext';
import { invokeFn } from '@/lib/invokeFn';
import { successToast } from '@/lib/successToast';
import { track } from '@/lib/analytics';
import {
  uploadSupportFiles, removeSupportFiles, buildFeedbackMeta, isAllowedSupportFile,
  SUPPORT_MAX_FILES, SUPPORT_MAX_FILE_MB, SUPPORT_MAX_TEXT, SUPPORT_ACCEPT,
} from '@/lib/supportTicket';
import { formatBytes } from '@/lib/formatBytes';

/**
 * Обратная связь / «Нашли баг? Сообщите нам!» (TRIP-232).
 *
 * Один диалог на уровне приложения (шит на телефоне даёт сам канон `Dialog` ≤640px).
 * Точка входа сейчас одна — строка в /settings; провайдер сделан app-level, чтобы
 * позже дёргать `useFeedback().open(source)` из трипа/других мест без форка.
 *
 * Поля — только каноничные из ДС (`Field`+`Textarea`, дропзона `.dl-dropzone` +
 * `FileRow`), ничего нового. Отправка активна при непустом тексте И/ИЛИ ≥1 файле.
 * Байты уходят в бакет `support` прямо из браузера; строку пишет edge
 * `supportTicketCreate` (в БД из браузера не пишем).
 */
const FeedbackContext = createContext({
  // ⚠️ ТИП open БЕРЁТСЯ ОТСЮДА (createContext выводит форму из значения по
  // умолчанию): заглушка нулевой арности давала бы TS2554 у вызывателя под
  // `// @ts-check` (ScreenAccount) на `open('settings')`.
  /** @type {(source?: string) => void} */
  open: () => {},
});
export const useFeedback = () => useContext(FeedbackContext);

const MB = 1024 * 1024;

function FeedbackDialog({ source, onClose }) {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  const inputRef = useRef(null);

  const [text, setText] = useState('');
  const [files, setFiles] = useState([]); // File[] — грузим только при отправке
  const [fileError, setFileError] = useState('');
  const [sending, setSending] = useState(false);

  const textLen = text.length;
  const over = textLen > SUPPORT_MAX_TEXT;
  const canSend = !sending && !over && (text.trim().length > 0 || files.length > 0);

  const addFiles = useCallback((incoming) => {
    setFileError('');
    const list = Array.from(incoming || []);
    if (!list.length) return;
    setFiles((prev) => {
      const next = [...prev];
      for (const f of list) {
        if (next.length >= SUPPORT_MAX_FILES) { setFileError(t('support.max_files', { max: SUPPORT_MAX_FILES })); break; }
        if (!isAllowedSupportFile(f)) { setFileError(t('support.bad_type')); continue; }
        if (f.size > SUPPORT_MAX_FILE_MB * MB) { setFileError(t('support.file_too_large', { name: f.name, mb: SUPPORT_MAX_FILE_MB })); continue; }
        next.push(f);
      }
      return next;
    });
    if (inputRef.current) inputRef.current.value = '';
  }, [t]);

  const removeAt = useCallback((idx) => {
    setFileError('');
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const submit = useCallback(async () => {
    if (!canSend) return;
    setSending(true);
    let uploadedPaths = [];
    try {
      // 1) Байты → бакет `support` (прямой шов). Пустой список — просто пропускаем.
      const { uploaded, errors } = await uploadSupportFiles(files);
      if (errors.length) {
        removeSupportFiles(uploaded.map((u) => u.path)); // подмести частично залитое
        toast({ description: t('support.upload_error'), variant: 'destructive' });
        return;
      }
      uploadedPaths = uploaded.map((u) => u.path);

      // 2) Строку тикета пишет edge под сервис-ролью.
      const { error } = await invokeFn('supportTicketCreate', {
        body: {
          source,
          text: text.trim(),
          files: uploaded,
          lang,
          meta: buildFeedbackMeta(),
        },
      });
      if (error) {
        removeSupportFiles(uploadedPaths); // тикет не сохранён — файлы осиротели
        toast({ description: t('support.send_error'), variant: 'destructive' });
        return; // окно и текст остаются — можно повторить
      }

      track('feedback_submitted', { source, has_files: uploaded.length > 0 });
      successToast(t, 'feedback_sent');
      onClose();
    } finally {
      setSending(false);
    }
  }, [canSend, files, source, text, lang, toast, t, onClose]);

  const filesHint = files.length
    ? t('support.files_count', { n: files.length, max: SUPPORT_MAX_FILES })
    : t('support.optional');

  return (
    <Dialog
      title={t('support.title')}
      icon="headset"
      onClose={onClose}
      foot={(
        <>
          <Btn variant="quiet" onClick={onClose} disabled={sending}>{t('common.cancel')}</Btn>
          <Btn variant="primary" icon="send" loading={sending} disabled={!canSend} onClick={submit}>
            {t('support.send')}
          </Btn>
        </>
      )}
    >
      <div className="col">
        <Field label={t('support.field_label')} hint={t('support.field_hint')}>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={t('support.placeholder')}
            aria-invalid={over ? 'true' : undefined}
          />
          {/* Счётчик — своей строкой справа под полем (как в норм-приложениях),
              один на строке → не переносится; спейсер — DS <Grow/>, не сырой span.
              Ниже — отдельная строка про уходящие с сообщением данные.
              floor-exempt: dsshare +3 — счётчик вынесен на свою строку по просьбе Pavel (UX: был разбит на 2 строки); совокупный сдвиг после мёрджа origin/dev, все правки — согласованный UX/унификация модалок */}
          <div className="row">
            <Grow />
            <span className={`t-meta ${over ? 'err' : 'muted'}`}>{`${textLen} / ${SUPPORT_MAX_TEXT}`}</span>
          </div>
          <span className="t-meta muted">{t('support.privacy_note')}</span>
          {over && (
            <div className="err">
              <Icon name="warning" size={13} />{t('support.too_long', { n: textLen - SUPPORT_MAX_TEXT })}
            </div>
          )}
        </Field>

        <Field label={t('support.files_label')} hint={filesHint}>
          {files.length > 0 && (
            <div className="dl-uplist col col--g3">
              {files.map((f, i) => (
                <FileRow
                  key={`${f.name}-${i}`}
                  name={f.name}
                  size={formatBytes(f.size)}
                  action={(
                    <IconBtn icon="close" tone="danger" size="sm" onClick={() => removeAt(i)} ariaLabel={t('support.remove_file')} />
                  )}
                />
              ))}
            </div>
          )}
          {files.length < SUPPORT_MAX_FILES && (
            <div
              onClick={() => !sending && inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
            >
              <Card variant="add" radius="btn" className="col col--g3 dl-dropzone">
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  hidden
                  accept={SUPPORT_ACCEPT}
                  onChange={(e) => addFiles(e.target.files)}
                />
                <Icon name="upload" size={24} />
                <b>{files.length === 0
                  ? t('support.drop_label')
                  : t('support.add_more', { left: SUPPORT_MAX_FILES - files.length })}</b>
                <span>{t('support.formats', { mb: SUPPORT_MAX_FILE_MB, max: SUPPORT_MAX_FILES })}</span>
              </Card>
            </div>
          )}
          {fileError && (
            <div className="err">
              <Icon name="warning" size={13} />{fileError}
            </div>
          )}
        </Field>
      </div>
    </Dialog>
  );
}

export function FeedbackProvider({ children }) {
  const [state, setState] = useState(null); // { source } | null

  const open = useCallback((source = 'settings') => setState({ source }), []);
  const value = useMemo(() => ({ open }), [open]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {state && (
        <FeedbackDialog source={state.source} onClose={() => setState(null)} />
      )}
    </FeedbackContext.Provider>
  );
}
