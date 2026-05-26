import React from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Success modal shown after a successful Stripe checkout — the "Welcome to Pro!"
 * screen. Single CTA that just closes the dialog (the user is already back on
 * the page they started the upgrade from).
 */
export default function WelcomeToProDialog({ open, onOpenChange }) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm text-center">
        {/* Accessible labels for screen readers — visually we render our own headings below. */}
        <DialogTitle className="sr-only">{t('sub.welcome_title')}</DialogTitle>
        <DialogDescription className="sr-only">{t('sub.welcome_desc')}</DialogDescription>

        <div className="flex justify-center pt-2">
          <div className="w-16 h-16 rounded-full bg-primary/15 flex items-center justify-center">
            <div className="w-11 h-11 rounded-full bg-primary flex items-center justify-center">
              <Check className="w-6 h-6 text-primary-foreground" strokeWidth={3} />
            </div>
          </div>
        </div>

        <h2 className="font-display text-2xl font-bold mt-2">{t('sub.welcome_title')}</h2>
        <p className="text-sm text-muted-foreground px-2 leading-relaxed">
          {t('sub.welcome_desc')}
        </p>

        <Button
          size="lg"
          className="w-full mt-2"
          onClick={() => onOpenChange(false)}
        >
          {t('sub.welcome_cta')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}