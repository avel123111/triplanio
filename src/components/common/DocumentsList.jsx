import React from 'react';
import { Paperclip, ExternalLink } from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Read-only list of documents shown in view dialogs.
 */
export default function DocumentsList({ documents = [], iconColor = 'text-primary', title = '' }) {
  const t = useT();
  const docs = Array.isArray(documents) ? documents.filter(d => d?.file_url) : [];
  if (docs.length === 0) return null;
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-semibold mb-3 min-w-0">
        <Paperclip className={`w-4 h-4 shrink-0 ${iconColor}`} />
        <span className="truncate">{title || t('event.documents')}</span>
        <span className="text-xs text-muted-foreground font-normal">· {docs.length}</span>
      </div>
      <ul className="space-y-1">
        {docs.map((d, i) => (
          <li key={`${d.file_url}-${i}`}>
            <a
              href={d.file_url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-secondary/60 transition min-w-0 group"
            >
              <Paperclip className={`w-3.5 h-3.5 shrink-0 ${iconColor} opacity-70`} />
              <span className="text-sm flex-1 min-w-0 break-all text-foreground">
                {d.file_name || t('event.file_word')}
              </span>
              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}