/**
 * Single expense row inside a CategoryBlock.
 * - System expenses: tappable → opens the source's ViewDialog (with Edit
 *   button inside when canEdit).
 * - Manual expenses: edit / delete buttons (when canEdit). Icon & color
 *   inherit from the parent category (so custom-category styling propagates).
 */
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { BedDouble, Car, Plane, Camera, Smartphone, Pencil, Trash2 } from 'lucide-react';
import { fmtMoney } from '@/lib/budget/money';
import { DateTime } from 'luxon';
import { useT } from '@/lib/i18n/I18nContext';
import SourceViewLoader from './SourceViewLoader';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import { resolveCustomCategoryStyle } from '@/lib/budget/categoryStyles';

const SOURCE_ICONS = {
  hotel: { Icon: BedDouble, color: 'text-blue-600 dark:text-blue-300 bg-blue-100 dark:bg-blue-950/40' },
  transfer: { Icon: Plane, color: 'text-primary bg-primary/10' },
  activity: { Icon: Camera, color: 'text-violet-700 dark:text-violet-300 bg-violet-100 dark:bg-violet-950/40' },
  service: { Icon: Smartphone, color: 'text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/40' },
};

export default function ExpenseRow({ expense, canEdit, category, onEdit, onDelete }) {
  const t = useT();
  const [sourceOpen, setSourceOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isSystem = expense.source_kind && expense.source_kind !== 'manual';

  let Icon, iconClass;
  if (isSystem) {
    const meta = SOURCE_ICONS[expense.source_kind] || { Icon: Car, color: 'text-muted-foreground bg-muted' };
    Icon = meta.Icon;
    iconClass = meta.color;
  } else if (category && category.kind !== 'system') {
    const style = resolveCustomCategoryStyle(category);
    Icon = style.Icon;
    iconClass = style.colorClass;
  } else {
    Icon = null;
    iconClass = '';
  }

  const dateStr = expense.spent_on
    ? DateTime.fromISO(expense.spent_on).toFormat('d LLL')
    : '';

  const amountStr = expense.original_amount != null
    ? fmtMoney(expense.original_amount, expense.original_currency || 'EUR')
    : '—';

  const handleRowClick = () => {
    if (isSystem) setSourceOpen(true);
  };

  return (
    <>
      <div
        onClick={handleRowClick}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg group ${
          isSystem ? 'cursor-pointer hover:bg-secondary/60 transition' : 'hover:bg-secondary/40'
        }`}
        role={isSystem ? 'button' : undefined}
        tabIndex={isSystem ? 0 : undefined}
        onKeyDown={(e) => { if (isSystem && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSourceOpen(true); } }}
      >
        {Icon ? (
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${iconClass}`}>
            <Icon className="w-4 h-4" />
          </div>
        ) : (
          <div className="w-8 h-8 rounded-lg bg-muted shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{expense.title}</div>
          {dateStr && <div className="text-xs text-muted-foreground">{dateStr}</div>}
        </div>

        <div className="text-sm font-semibold tabular-nums shrink-0">{amountStr}</div>

        {!isSystem && canEdit && (
          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => { e.stopPropagation(); onEdit(expense); }}
              aria-label={t('common.edit')}
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
              aria-label={t('common.delete')}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
      </div>

      {isSystem && (
        <SourceViewLoader
          kind={expense.source_kind}
          id={expense.source_id}
          open={sourceOpen}
          onOpenChange={setSourceOpen}
          canEdit={canEdit}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('budget.expense_delete_confirm_title')}
        description={t('budget.expense_delete_confirm_msg', { title: expense.title })}
        variant="destructive"
        onConfirm={() => { setConfirmDelete(false); onDelete(expense); }}
      />
    </>
  );
}