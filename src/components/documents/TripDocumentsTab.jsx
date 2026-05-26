import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { FileText, Plus, Users, Lock, ExternalLink, Download, MoreVertical, Pencil, Trash2, Link as LinkIcon } from 'lucide-react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import ReactMarkdown from 'react-markdown';
import TripDocumentDialog from './TripDocumentDialog';
import TripDocumentViewDialog from './TripDocumentViewDialog';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { getEntityDocuments } from '@/lib/documents';
import { useT } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';

export default function TripDocumentsTab({ tripId, canEdit }) {
  const t = useT();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState({ open: false, doc: null, defaultVisibility: 'shared' });
  const [viewDoc, setViewDoc] = useState(null);
  const [confirmDel, setConfirmDel] = useState({ open: false, docId: null });

  const { data: allDocs = [], isLoading } = useQuery({
    queryKey: ['trip-documents', tripId],
    queryFn: () => base44.entities.TripDocument.filter({ trip_id: tripId }, '-created_date'),
  });

  const { data: members = [] } = useQuery({
    queryKey: ['trip-members', tripId],
    queryFn: () => base44.entities.TripMember.filter({ trip_id: tripId }),
    enabled: !!tripId,
  });
  // Map user_email → full_name for author display
  const memberNameByEmail = React.useMemo(() => {
    const map = {};
    members.forEach(m => { if (m.user_email && m.user_full_name) map[m.user_email] = m.user_full_name; });
    return map;
  }, [members]);

  // Split: shared vs private (user's own)
  const sharedDocs = allDocs.filter(d => d.visibility !== 'private');
  const privateDocs = allDocs.filter(d => d.visibility === 'private' && d.created_by_id === user?.id);

  const delMut = useMutation({
    mutationFn: (id) => base44.entities.TripDocument.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trip-documents', tripId] }),
  });

  const openAdd = (visibility) => setDialog({ open: true, doc: null, defaultVisibility: visibility });
  const openEdit = (doc) => setDialog({ open: true, doc, defaultVisibility: doc.visibility || 'shared' });

  return (
    <div>
      {/* Header — always visible */}
      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 className="font-display font-bold text-xl">{t('doc.tab_title')}</h2>
        {canEdit && (
          <Button onClick={() => openAdd('shared')}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />{t('doc.btn_add')}
          </Button>
        )}
      </div>

      {/* Shared documents section */}
      <DocSection
        title={t('doc.section_shared')}
        badge={sharedDocs.length}
        hint={t('doc.section_shared_hint')}
        icon={<Users className="w-4 h-4 text-primary" />}
        docs={sharedDocs}
        isLoading={isLoading}
        canEdit={canEdit}
        emptyLabel={t('doc.shared_empty')}
        addLabel={t('doc.add_shared')}
        onAdd={() => openAdd('shared')}
        onEdit={openEdit}
        onView={setViewDoc}
        onDelete={(id) => setConfirmDel({ open: true, docId: id })}
        memberNameByEmail={memberNameByEmail}
      />

      <div className="mt-6" />

      {/* Private documents section */}
      <DocSection
        title={t('doc.section_private')}
        badge={privateDocs.length}
        hint={t('doc.section_private_hint')}
        icon={<Lock className="w-4 h-4 text-orange-500" />}
        docs={privateDocs}
        isLoading={isLoading}
        canEdit={canEdit}
        emptyLabel={t('doc.private_empty')}
        addLabel={t('doc.add_private')}
        onAdd={() => openAdd('private')}
        onEdit={openEdit}
        onView={setViewDoc}
        onDelete={(id) => setConfirmDel({ open: true, docId: id })}
        iconColorClass="bg-orange-100 dark:bg-orange-950/40 text-orange-600 dark:text-orange-300"
      />

      {dialog.open && (
        <TripDocumentDialog
          open={dialog.open}
          onOpenChange={(o) => setDialog((s) => ({ ...s, open: o }))}
          tripId={tripId}
          doc={dialog.doc}
          defaultVisibility={dialog.defaultVisibility}
        />
      )}

      <TripDocumentViewDialog
        open={!!viewDoc}
        onOpenChange={(o) => { if (!o) setViewDoc(null); }}
        doc={viewDoc}
        readOnly={!canEdit}
        onEdit={canEdit ? () => { openEdit(viewDoc); setViewDoc(null); } : undefined}
      />

      <ConfirmDialog
        open={confirmDel.open}
        onOpenChange={(o) => setConfirmDel((s) => ({ ...s, open: o }))}
        title={t('common.delete_confirm_title')}
        description={t('doc.tab_delete_confirm')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={() => {
          if (confirmDel.docId) delMut.mutate(confirmDel.docId);
          setConfirmDel({ open: false, docId: null });
        }}
      />
    </div>
  );
}

// ── Section component ──────────────────────────────────────────────────────
function DocSection({ title, badge, hint, icon, docs, isLoading, canEdit, emptyLabel, addLabel, onAdd, onEdit, onView, onDelete, iconColorClass, memberNameByEmail = {} }) {
  const t = useT();
  const defaultIconColor = iconColorClass || 'bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300';

  return (
    <div>
      {/* Section header — always visible */}
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="font-semibold text-sm">{title}</span>
        {!isLoading && badge > 0 && (
          <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">{badge}</span>
        )}
        {hint && (
          <span className="ml-auto text-xs text-muted-foreground">{hint}</span>
        )}
      </div>

      {/* Grid of cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {isLoading && [1,2,3].map(i => (
          <div key={i} className="rounded-xl border bg-card p-4 h-24 animate-pulse">
            <div className="flex gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-muted shrink-0" />
              <div className="flex-1 space-y-2 pt-0.5">
                <div className="h-4 w-3/4 bg-muted rounded" />
                <div className="h-3 w-1/2 bg-muted rounded" />
              </div>
            </div>
          </div>
        ))}
        {!isLoading && docs.map((d) => {
          const files = getEntityDocuments({
            voucher_file_url: d.file_url,
            voucher_file_name: d.file_name,
            documents: d.documents,
          });
          const authorName = memberNameByEmail[d.created_by] || null;
          return (
            <DocCard
              key={d.id}
              doc={d}
              files={files}
              canEdit={canEdit}
              iconColorClass={defaultIconColor}
              authorName={authorName}
              onView={() => onView(d)}
              onEdit={() => onEdit(d)}
              onDelete={() => onDelete(d.id)}
              t={t}
            />
          );
        })}

        {/* "Add new" placeholder card */}
        {!isLoading && canEdit && (
          <button
            type="button"
            onClick={onAdd}
            className="rounded-xl border-2 border-dashed border-border hover:border-primary/40 hover:bg-accent/30 transition flex flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground hover:text-foreground min-h-[100px]"
          >
            <Plus className="w-4 h-4" />
            <span>{addLabel}</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Individual doc card ────────────────────────────────────────────────────
function DocCard({ doc, files, canEdit, iconColorClass, authorName, onView, onEdit, onDelete, t }) {
  return (
    <div
      onClick={onView}
      className="rounded-xl border bg-card p-4 flex flex-col gap-2 cursor-pointer hover:bg-secondary/30 transition relative group"
    >
      <div className="flex items-start gap-2.5">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${iconColorClass}`}>
          <FileText className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm break-words leading-tight">{doc.title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {files.length > 0
              ? t('doc.card_files_count', { n: files.length })
              : t('doc.card_no_files')}
            {doc.link_url ? ` · ${t('doc.tab_open_link').toLowerCase()}` : ''}
          </div>
        </div>
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="w-7 h-7 opacity-0 group-hover:opacity-100 transition shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                <Pencil className="w-3.5 h-3.5 mr-2" />{t('common.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" />{t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {doc.notes && (
        <div className="text-xs text-muted-foreground leading-snug line-clamp-2">
          {doc.notes}
        </div>
      )}

      {authorName && (
        <div className="text-[11px] text-muted-foreground/70 mt-auto pt-1 border-t border-border/50 truncate">
          {authorName}
        </div>
      )}
    </div>
  );
}