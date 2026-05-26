import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, Plus } from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';

export default function NewTripModal({ open, onOpenChange, onManualPick, onAiPick }) {
  const t = useT();
  const [isClosing, setIsClosing] = useState(false);

  React.useEffect(() => {
    if (open) {
      setIsClosing(false);
    }
  }, [open]);

  const handlePick = (pick) => {
    setIsClosing(true);
    onOpenChange(false);
    setTimeout(() => {
      if (pick === 'manual') {
        onManualPick();
      } else {
        onAiPick();
      }
    }, 200);
  };

  return (
    <Dialog open={open && !isClosing} onOpenChange={(o) => {
      if (o) setIsClosing(false);
      onOpenChange(o);
    }}>
      <DialogContent className="max-w-md">
        <DialogHeader className="text-center sm:text-center">
          <DialogTitle className="text-2xl font-bold text-center">{t('trips.new_trip_title')}</DialogTitle>
          <DialogDescription className="text-center text-sm mt-2">
            {t('trips.new_trip_desc')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 py-4">
          <button
            type="button"
            onClick={() => handlePick('manual')}
            className="group rounded-xl border-2 border-border bg-card p-6 text-left transition-all hover:border-primary hover:shadow-md hover:shadow-primary/10 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-colors">
                <Plus className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-base mb-1">{t('trips.manual_title')}</h3>
                <p className="text-sm text-muted-foreground">{t('trips.manual_desc')}</p>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handlePick('ai')}
            className="group rounded-xl border-2 border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 p-6 text-left transition-all hover:border-violet-400 hover:shadow-md hover:shadow-violet-500/10 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-violet-500/10 flex items-center justify-center text-violet-600 group-hover:bg-violet-500 group-hover:text-white transition-colors">
                <Sparkles className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-base mb-1">{t('trips.ai_title')}</h3>
                <p className="text-sm text-muted-foreground">{t('trips.ai_desc')}</p>
              </div>
            </div>
          </button>
        </div>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}