import React from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/I18nContext';

export default function AiFeatureLock({ onUnlock, className }) {
  const t = useT();
  return (
    <div className={`relative ${className || ''}`}>
      <div className="absolute inset-0 bg-muted/60 backdrop-blur-[1px] z-10 flex items-center justify-center rounded-lg">
        <div className="text-center p-4">
          <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-muted-foreground/10 flex items-center justify-center">
            <Lock className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-muted-foreground mb-2">
            {t('sub.ai_locked')}
          </p>
          <Button size="sm" onClick={onUnlock}>
            <Lock className="w-3.5 h-3.5 mr-1.5" />
            {t('sub.unlock')}
          </Button>
        </div>
      </div>
      <div className="opacity-30 pointer-events-none">
        {React.Children.toArray(arguments[1]).map((child, i) => child)}
      </div>
    </div>
  );
}