/**
 * Edits TripBudget.fx_overrides — a map { currencyCode: rate } where
 * 1 unit of currencyCode = rate units of the trip's main currency.
 *
 * The list of editable currencies is derived from the expenses in this trip
 * (excluding the main currency). For each, we show the live rate as a hint
 * and let the user provide their own override.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useT } from '@/lib/i18n/I18nContext';

function liveRateToMain(fx, code) {
  // fx: { base: mainCurrency, rates: { CODE: rate } } — 1 main = rate CODE
  // → 1 CODE = 1 / rate of main
  const r = fx?.rates?.[code];
  if (!r || !Number.isFinite(Number(r)) || Number(r) <= 0) return null;
  return 1 / Number(r);
}

export default function FxOverridesDialog({
  open, onOpenChange, mainCurrency, currencies, currentOverrides, fx, onSave, isSaving,
}) {
  const t = useT();
  const otherCurrencies = useMemo(
    () => currencies.filter((c) => c && c !== mainCurrency),
    [currencies, mainCurrency]
  );

  const [values, setValues] = useState({});

  useEffect(() => {
    if (!open) return;
    const init = {};
    otherCurrencies.forEach((c) => {
      const v = currentOverrides?.[c];
      init[c] = v != null ? String(v) : '';
    });
    setValues(init);
  }, [open, currentOverrides, otherCurrencies]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const next = {};
    Object.entries(values).forEach(([code, raw]) => {
      const n = Number(raw);
      if (raw !== '' && Number.isFinite(n) && n > 0) next[code] = n;
    });
    onSave(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('budget.fx_title')}</DialogTitle>
          <p className="text-xs text-muted-foreground pt-1">
            {t('budget.fx_subtitle', { currency: mainCurrency })}
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3 py-2">
          {otherCurrencies.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-4">
              {t('budget.fx_no_other')}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[80px_1fr] gap-3 text-[11px] uppercase tracking-wider text-muted-foreground px-1">
                <div>{t('budget.fx_col_currency')}</div>
                <div>{t('budget.fx_col_rate', { main: mainCurrency })}</div>
              </div>
              {otherCurrencies.map((code) => {
                const live = liveRateToMain(fx, code);
                return (
                  <div key={code} className="grid grid-cols-[80px_1fr] gap-3 items-center">
                    <div className="font-mono font-semibold text-sm">{code}</div>
                    <div>
                      <Input
                        type="number"
                        step="0.0001"
                        inputMode="decimal"
                        placeholder={live ? live.toFixed(4) : ''}
                        value={values[code] ?? ''}
                        onChange={(e) => setValues((v) => ({ ...v, [code]: e.target.value }))}
                      />
                      {live != null && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {t('budget.fx_live_rate', { rate: live.toFixed(4) })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSaving}>{t('budget.fx_save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}