import React from 'react';
import { Pencil, StickyNote, Plus } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

/**
 * Inline notes block for a city.
 * - If notes exist: render markdown + small edit pencil in the corner.
 * - If notes missing: render a compact "Add notes" affordance (only when canEdit).
 * - If notes missing and !canEdit: render nothing.
 */
export default function CityNotesBlock({ notes, canEdit, onEdit }) {
  const { t } = useI18nFormat();
  const hasNotes = !!(notes && notes.trim());

  if (!hasNotes && !canEdit) return null;

  if (!hasNotes) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border text-muted-foreground hover:bg-secondary/40 hover:text-foreground transition text-left text-sm"
      >
        <Plus className="w-3.5 h-3.5" />
        {t('visit.add_notes')}
      </button>
    );
  }

  return (
    <div className="rounded-xl bg-secondary/60 dark:bg-secondary/40 p-3 pr-10 relative">
      <div className="flex items-center gap-1.5 mb-1.5 text-xs font-semibold text-muted-foreground">
        <StickyNote className="w-3.5 h-3.5" />{t('visit.notes_label')}
      </div>
      <div className="prose prose-xs dark:prose-invert max-w-none break-words text-xs text-muted-foreground leading-snug">
        <ReactMarkdown>{notes}</ReactMarkdown>
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={onEdit}
          className="absolute top-2 right-2 p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition"
          aria-label={t('visit.edit_notes_aria')}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}