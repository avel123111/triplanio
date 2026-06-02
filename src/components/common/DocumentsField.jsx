import React, { useRef, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import { safeStorageName } from '@/lib/storage';
import { Paperclip, Upload, X, Loader2, Plus } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

/**
 * Multi-file document field. Manages an array of { file_url, file_name }.
 * - `value` and `onChange` work with an array.
 * - `maxFiles` (optional): caps the count (no cap by default).
 * - `label`: section title (optional).
 * - `iconColor`: tailwind text color for the section icon.
 */
export default function DocumentsField({
  value = [],
  onChange,
  onUploadingChange,
  maxFiles = null,
  label = 'Документы',
  iconColor = 'text-primary',
  accept = '*',
  maxFileSizeMb = 10,
}) {
  const { toast } = useToast();
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const setUploadingWithCb = (val) => {
    setUploading(val);
    onUploadingChange?.(val);
  };

  const docs = Array.isArray(value) ? value : [];
  const canAddMore = maxFiles === null || docs.length < maxFiles;

  const uploadFiles = async (files) => {
    if (!files?.length) return;
    const remaining = maxFiles === null ? files.length : Math.max(0, maxFiles - docs.length);
    const toUpload = Array.from(files).slice(0, remaining);
    if (toUpload.length === 0) return;
    const oversize = toUpload.find(f => f.size > maxFileSizeMb * 1024 * 1024);
    if (oversize) {
      toast({
        title: 'Файл слишком большой',
        description: `Максимальный размер - ${maxFileSizeMb} МБ.`,
        variant: 'destructive',
      });
      return;
    }
    setUploadingWithCb(true);
    try {
      const uploaded = [];
      for (const file of toUpload) {
        const uid = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const path = `attachments/${uid}/${safeStorageName(file.name)}`;
        const { error: upErr } = await supabase.storage.from('documents').upload(path, file);
        if (upErr) {
          toast({ title: 'Не удалось загрузить файл', description: upErr.message, variant: 'destructive' });
          continue;
        }
        // Long-lived signed URL (10 years) - matches the documents lens convention.
        const { data: urlData } = await supabase.storage.from('documents').createSignedUrl(path, 315360000);
        uploaded.push({ file_url: urlData?.signedUrl || '', file_name: file.name, storage_path: path });
      }
      if (uploaded.length) onChange([...docs, ...uploaded]);
    } finally {
      setUploadingWithCb(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const removeAt = (idx) => {
    const next = docs.slice();
    next.splice(idx, 1);
    onChange(next);
  };

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold min-w-0">
          <Paperclip className={`w-4 h-4 shrink-0 ${iconColor}`} />
          <span className="truncate">{label}</span>
          {docs.length > 0 && (
            <span className="text-xs text-muted-foreground font-normal">· {docs.length}</span>
          )}
        </div>
      </div>

      {docs.length > 0 && (
        <ul className="space-y-1.5 mb-2">
          {docs.map((d, i) => (
            <li key={`${d.file_url}-${i}`} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/60 min-w-0">
              <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <a
                href={d.file_url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-primary hover:underline flex-1 min-w-0 break-all"
              >
                {d.file_name || 'Файл'}
              </a>
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="p-1 rounded hover:bg-background shrink-0"
                aria-label="Удалить документ"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {canAddMore && (
        <div
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); uploadFiles(e.dataTransfer.files); }}
          className="cursor-pointer rounded-lg border-2 border-dashed border-border hover:border-primary/60 p-4 text-center transition"
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            accept={accept}
            onChange={(e) => uploadFiles(e.target.files)}
          />
          {uploading ? (
            <div className="flex items-center justify-center gap-2 text-sm text-primary">
              <Loader2 className="w-4 h-4 animate-spin" />Загрузка…
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              {docs.length === 0 ? (
                <>
                  <Upload className="w-4 h-4" />
                  <span>Загрузить файлы • до {maxFileSizeMb}MB каждый</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>Добавить ещё файлы{maxFiles ? ` (осталось ${maxFiles - docs.length})` : ''}</span>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}