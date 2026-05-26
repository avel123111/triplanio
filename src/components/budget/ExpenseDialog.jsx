/**
 * Create / edit a manual BudgetExpense.
 *
 * NOTE: only `source_kind='manual'` expenses are editable through this dialog.
 * System expenses (hotel/transfer/activity/service) are read-only here.
 */
import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import CurrencyCombobox from '@/components/ui/CurrencyCombobox';
import { useT } from '@/lib/i18n/I18nContext';
import { SYSTEM_CATEGORY_NAME_KEY } from '@/lib/budget/constants';

export default function ExpenseDialog({
  open, onOpenChange, expense, categories, defaultCategoryId, defaultCurrency,
  onSubmit, isSaving,
}) {
  const t = useT();
  const isEdit = !!expense;

  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency || 'EUR');
  const [date, setDate] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!open) return;
    if (expense) {
      setTitle(expense.title || '');
      setAmount(expense.original_amount != null ? String(expense.original_amount) : '');
      setCurrency(expense.original_currency || defaultCurrency || 'EUR');
      setDate(expense.spent_on || '');
      setCategoryId(expense.category_id || '');
    } else {
      setTitle('');
      setAmount('');
      setCurrency(defaultCurrency || 'EUR');
      setDate('');
      setCategoryId(defaultCategoryId || categories?.[0]?.id || '');
    }
    setErrors({});
  }, [open, expense, defaultCategoryId, defaultCurrency, categories]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const next = {};
    if (!title.trim()) next.title = t('budget.title_required');
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) next.amount = t('budget.amount_required');
    setErrors(next);
    if (Object.keys(next).length) return;

    onSubmit({
      title: title.trim(),
      original_amount: amt,
      original_currency: currency || 'EUR',
      spent_on: date || undefined,
      category_id: categoryId,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('budget.expense_edit') : t('budget.expense_new')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3 py-2">
          <div>
            <Label className="text-xs">{t('budget.field_title')}</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              className="mt-1"
            />
            {errors.title && <div className="text-xs text-destructive mt-1">{errors.title}</div>}
          </div>

          <div className="grid grid-cols-[1fr_140px] gap-2">
            <div>
              <Label className="text-xs">{t('budget.field_amount')}</Label>
              <Input
                type="number"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1"
              />
              {errors.amount && <div className="text-xs text-destructive mt-1">{errors.amount}</div>}
            </div>
            <div>
              <Label className="text-xs">{t('budget.field_currency')}</Label>
              <div className="mt-1">
                <CurrencyCombobox value={currency} onChange={setCurrency} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">{t('budget.field_date')}</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">{t('budget.field_category')}</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.kind === 'system'
                        ? t(SYSTEM_CATEGORY_NAME_KEY[c.system_key] || c.name)
                        : c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSaving}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}