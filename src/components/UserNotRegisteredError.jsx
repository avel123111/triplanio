import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { BRAND_NAME, BRAND_LOGO_URL } from '@/lib/brand';

const UserNotRegisteredError = () => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
      {/* Brand */}
      <div className="flex items-center gap-2 mb-8">
        <img src={BRAND_LOGO_URL} alt={BRAND_NAME} className="w-9 h-9" />
        <span className="font-display font-bold text-lg tracking-tight">{BRAND_NAME}</span>
      </div>

      <div className="max-w-md w-full p-8 bg-card rounded-2xl shadow-lg border">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 mb-5 rounded-full bg-amber-100 dark:bg-amber-950/40">
            <AlertTriangle className="w-7 h-7 text-amber-600 dark:text-amber-400" />
          </div>
          <h1 className="text-2xl font-display font-bold mb-3">Доступ ограничен</h1>
          <p className="text-muted-foreground mb-6 text-sm">
            Ваш аккаунт не зарегистрирован в этом приложении. Обратитесь к администратору, чтобы получить доступ.
          </p>
          <Button variant="outline" onClick={() => base44.auth.logout()} className="w-full">
            Выйти и попробовать другой аккаунт
          </Button>
        </div>
      </div>
    </div>
  );
};

export default UserNotRegisteredError;