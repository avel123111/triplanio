/**
 * Create-or-rename dialog for custom (non-system) budget categories.
 * Lets the user pick a name, an icon and a color.
 */
import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useT } from '@/lib/i18n/I18nContext';
import IconColorPicker from './IconColorPicker';
import { DEFAULT_CUSTOM_ICON, DEFAULT_CUSTOM_COLOR } from '@/lib/budget/categoryStyles';

export default function CategoryNameDialog({ open, onOpenChange, category, onSubmit, isSaving }) {
  const t = useT();
  const isEdit = !!category;
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(DEFAULT_CUSTOM_ICON);
  const [color, setColor] = useState(DEFAULT_CUSTOM_COLOR);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(category?.name || '');
    setIcon(category?.icon || DEFAULT_CUSTOM_ICON);
    setColor(category?.color || DEFAULT_CUSTOM_COLOR);
    setError('');
  }, [open, category]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) { setError(t('budget.category_name_required')); return; }
    onSubmit({ name: name.trim(), icon, color });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('budget.category_rename') : t('budget.category_new')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div>
            <Label className="text-xs">{t('budget.field_title')}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('budget.category_name_placeholder')}
              autoFocus
              className="mt-1"
            />
            {error && <div className="text-xs text-destructive mt-1">{error}</div>}
          </div>

          <IconColorPicker
            icon={icon}
            color={color}
            onIconChange={setIcon}
            onColorChange={setColor}
          />

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSaving}>{t('common.save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}