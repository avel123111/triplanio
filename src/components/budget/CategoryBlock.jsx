/**
 * One category block on the budget page.
 * - Shows the category name + its subtotal in the trip's main currency.
 * - Collapsible list of expenses.
 * - For custom (non-system) categories: rename / delete menu.
 */
import React, { useMemo, useState } from 'react';
import { useT } from '@/lib/i18n/I18nContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, ChevronRight, MoreHorizontal, Pencil, Trash2, Plus, BedDouble, Plane, Camera, Smartphone } from 'lucide-react';
import { fmtMoney, toMain } from '@/lib/budget/money';
import { SYSTEM_CATEGORY_NAME_KEY } from '@/lib/budget/constants';
import { resolveCustomCategoryStyle } from '@/lib/budget/categoryStyles';
import ExpenseRow from './ExpenseRow';

const SYSTEM_ICON = {
  accommodation: { Icon: BedDouble, color: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' },
  transport: { Icon: Plane, color: 'bg-primary/10 text-primary' },
  activities: { Icon: Camera, color: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300' },
  services: { Icon: Smartphone, color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
};

export default function CategoryBlock({
  category,
  expenses,
  mainCurrency,
  fx,
  fxOverrides,
  canEdit,
  onAddExpense,
  onEditExpense,
  onDeleteExpense,
  onRenameCategory,
  onDeleteCategory,
}) {
  const t = useT();
  const [open, setOpen] = useState(true);

  const isSystem = category.kind === 'system';
  const displayName = isSystem
    ? t(SYSTEM_CATEGORY_NAME_KEY[category.system_key] || category.name)
    : category.name;

  const customStyle = !isSystem ? resolveCustomCategoryStyle(category) : null;
  const iconMeta = isSystem ? SYSTEM_ICON[category.system_key] : null;
  const Icon = isSystem ? iconMeta.Icon : customStyle.Icon;
  const iconColor = isSystem ? iconMeta.color : customStyle.colorClass;

  const subtotal = useMemo(() => {
    let sum = 0;
    expenses.forEach((e) => {
      const { value, ok } = toMain(
        e.original_amount,
        e.original_currency || mainCurrency,
        mainCurrency,
        fx,
        fxOverrides,
      );
      if (ok) sum += value;
    });
    return sum;
  }, [expenses, mainCurrency, fx, fxOverrides]);

  return (
    <div className="rounded-2xl border bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${iconColor}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm truncate">{displayName}</div>
            <div className="text-xs text-muted-foreground">
              {expenses.length === 0
                ? t('budget.no_expenses')
                : `${expenses.length}`}
            </div>
          </div>
          <div className="font-display text-base font-bold tabular-nums shrink-0">
            {fmtMoney(subtotal, mainCurrency)}
          </div>
          {open
            ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
        </button>

        {!isSystem && canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="menu">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onRenameCategory(category)}>
                <Pencil className="w-3.5 h-3.5 mr-2" />{t('budget.category_menu_rename')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDeleteCategory(category)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" />{t('budget.category_menu_delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {open && (
        <div className="border-t bg-background/40 px-2 py-2 space-y-0.5">
          {expenses.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">
              {t('budget.no_expenses')}
            </div>
          ) : (
            expenses.map((e) => (
              <ExpenseRow
                key={e.id}
                expense={e}
                canEdit={canEdit}
                category={category}
                onEdit={onEditExpense}
                onDelete={onDeleteExpense}
              />
            ))
          )}

          {canEdit && (
            <div className="px-1 pt-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => onAddExpense(category)}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />{t('budget.add_expense')}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}