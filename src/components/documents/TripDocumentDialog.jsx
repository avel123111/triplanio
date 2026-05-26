import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Link as LinkIcon, Users, Lock } from 'lucide-react';
import DocumentsField from '@/components/common/DocumentsField';
import { getEntityDocuments } from '@/lib/documents';
import { useT } from '@/lib/i18n/I18nContext';

const empty = { title: '', notes: '', documents: [], link_url: '', visibility: 'shared' };

export default function TripDocumentDialog({ open, onOpenChange, tripId, doc = null, defaultVisibility = 'shared' }) {
  const t = useT();
  const qc = useQueryClient();
  const isEdit = !!doc;
  const [form, setForm] = useState(empty);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (doc) {
      const docs = getEntityDocuments({
        voucher_file_url: doc.file_url,
        voucher_file_name: doc.file_name,
        documents: doc.documents,
      });
      setForm({
        title: doc.title || '',
        notes: doc.notes || '',
        documents: docs,
        link_url: doc.link_url || '',
        visibility: doc.visibility || 'shared',
      });
    } else {
      setForm({ ...empty, visibility: defaultVisibility });
    }
  }, [open, doc, defaultVisibility]);

  const mutation = useMutation({
    mutationFn: async () => {
      const docs = Array.isArray(form.documents) ? form.documents : [];
      const payload = {
        trip_id: tripId,
        title: form.title.trim(),
        notes: form.notes || '',
        documents: docs,
        file_url: docs[0]?.file_url || '',
        file_name: docs[0]?.file_name || '',
        link_url: form.link_url || '',
        visibility: form.visibility,
      };
      if (isEdit) return base44.entities.TripDocument.update(doc.id, payload);
      return base44.entities.TripDocument.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-documents', tripId] });
      onOpenChange(false);
    },
  });

  const canSave = form.title.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto bg-white dark:bg-card [&_input]:bg-white dark:[&_input]:bg-card [&_textarea]:bg-white dark:[&_textarea]:bg-card">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <LinkIcon className="w-5 h-5 text-primary" />
            </div>
            <DialogTitle className="font-display text-2xl">
              {isEdit ? t('doc.dialog_edit') : t('doc.dialog_new')}
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-5">
          {/* Visibility selector */}
          <div>
            <Label className="mb-2 block">{t('doc.visibility_label')}</Label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, visibility: 'shared' })}
                className={`rounded-xl border-2 p-3 text-left transition ${
                  form.visibility === 'shared'
                    ? 'border-primary bg-accent/30'
                    : 'border-border hover:border-border/60 hover:bg-secondary/40'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Users className={`w-4 h-4 ${form.visibility === 'shared' ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="text-sm font-semibold">{t('doc.visibility_shared')}</span>
                </div>
                <div className="text-xs text-muted-foreground leading-snug">{t('doc.visibility_shared_desc')}</div>
              </button>

              <button
                type="button"
                onClick={() => setForm({ ...form, visibility: 'private' })}
                className={`rounded-xl border-2 p-3 text-left transition ${
                  form.visibility === 'private'
                    ? 'border-primary bg-accent/30'
                    : 'border-border hover:border-border/60 hover:bg-secondary/40'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Lock className={`w-4 h-4 ${form.visibility === 'private' ? 'text-primary' : 'text-muted-foreground'}`} />
                  <span className="text-sm font-semibold">{t('doc.visibility_private')}</span>
                </div>
                <div className="text-xs text-muted-foreground leading-snug">{t('doc.visibility_private_desc')}</div>
              </button>
            </div>
          </div>

          {/* Title */}
          <div>
            <Label>{t('doc.title_required')}</Label>
            <Input
              className="mt-1.5"
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder={t('doc.title_placeholder')}
              autoFocus
            />
          </div>

          {/* Notes */}
          <div>
            <Label>{t('doc.notes_label')}</Label>
            <Textarea
              className="mt-1.5"
              rows={3}
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder={t('doc.notes_placeholder')}
            />
          </div>

          {/* Link */}
          <div>
            <Label className="flex items-center gap-1.5"><LinkIcon className="w-3.5 h-3.5" />{t('doc.link_label')}</Label>
            <Input
              className="mt-1.5"
              value={form.link_url}
              onChange={e => setForm({ ...form, link_url: e.target.value })}
              placeholder={t('doc.link_placeholder')}
            />
          </div>

          {/* Files */}
          <DocumentsField
            value={form.documents}
            onChange={(docs) => setForm({ ...form, documents: docs })}
            onUploadingChange={setUploading}
            label={t('doc.files_label')}
            iconColor="text-blue-600 dark:text-blue-300"
          />
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSave || mutation.isPending || uploading}>
            {mutation.isPending && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
            {isEdit ? t('doc.btn_save') : t('doc.btn_add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}