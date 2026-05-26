import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Paperclip, LinkIcon, ExternalLink, Download, Pencil, StickyNote } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { getEntityDocuments } from '@/lib/documents';
import { useT } from '@/lib/i18n/I18nContext';

export default function TripDocumentViewDialog({ open, onOpenChange, doc, onEdit, readOnly = false }) {
  const t = useT();
  if (!doc) return null;

  const files = getEntityDocuments({
    voucher_file_url: doc.file_url,
    voucher_file_name: doc.file_name,
    documents: doc.documents,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 max-h-[90vh] overflow-y-auto gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-start gap-3 pr-8">
            <div className="w-11 h-11 rounded-full bg-blue-100 dark:bg-blue-950/40 flex items-center justify-center shrink-0">
              <Paperclip className="w-5 h-5 text-blue-600 dark:text-blue-300" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="font-display text-2xl break-words">{doc.title}</DialogTitle>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-4 space-y-3">
          {files.length > 0 && (
            <section className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-semibold mb-3">
                <Paperclip className="w-4 h-4 text-blue-600 dark:text-blue-300" />
                {t('doc.view_files_label')}
                <span className="text-xs text-muted-foreground font-normal">· {files.length}</span>
              </div>
              <ul className="space-y-1">
                {files.map((f, i) => (
                  <li key={`${f.file_url}-${i}`}>
                    <a
                      href={f.file_url}
                      target="_blank"
                      rel="noreferrer"
                      download={f.file_name || true}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-secondary/60 transition group"
                    >
                      <Download className="w-3.5 h-3.5 text-blue-600 dark:text-blue-300 shrink-0" />
                      <span className="text-sm flex-1 min-w-0 break-all">{f.file_name || t('doc.tab_download_file')}</span>
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {doc.link_url && (
            <a
              href={doc.link_url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2.5 p-3 rounded-xl bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200/70 dark:hover:bg-blue-950/60 transition"
            >
              <LinkIcon className="w-4 h-4 shrink-0" />
              <div className="flex-1 text-sm font-medium min-w-0 break-all">{t('doc.view_open_link')}</div>
              <ExternalLink className="w-3.5 h-3.5 opacity-70 shrink-0" />
            </a>
          )}

          {doc.notes && (
            <section className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-semibold mb-2">
                <StickyNote className="w-4 h-4 text-blue-600 dark:text-blue-300" />{t('doc.view_notes')}
              </div>
              <div className="text-sm text-muted-foreground prose prose-sm dark:prose-invert max-w-none break-words">
                <ReactMarkdown>{doc.notes}</ReactMarkdown>
              </div>
            </section>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t bg-secondary/30 flex sm:justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
          {!readOnly && onEdit && (
            <Button onClick={onEdit}>
              <Pencil className="w-3.5 h-3.5 mr-1.5" />{t('common.edit')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}