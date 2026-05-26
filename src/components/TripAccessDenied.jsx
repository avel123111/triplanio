import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function TripAccessDenied() {
  const nav = useNavigate();
  const goHome = () => nav('/');
  return (
    <div className="max-w-md mx-auto py-16 text-center">
      <div className="inline-flex items-center justify-center w-14 h-14 mb-5 rounded-full bg-amber-100 dark:bg-amber-950/40">
        <Lock className="w-7 h-7 text-amber-600 dark:text-amber-400" />
      </div>
      <h1 className="font-display text-2xl font-bold mb-2">У вас нет доступа к этой поездке</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Возможно, вас больше нет в списке участников, или владелец отменил приглашение.
      </p>
      <Button onClick={goHome} variant="outline">
        <ArrowLeft className="w-4 h-4 mr-1.5" />Назад к списку
      </Button>
    </div>
  );
}