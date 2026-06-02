import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { SystemStub } from '@/lib/PageNotFound';

export default function TripAccessDenied() {
  const nav = useNavigate();
  const { logout } = useAuth();
  const loginOther = async () => {
    try { await logout?.(false); } catch { /* ignore */ }
    nav('/login');
  };
  return (
    <SystemStub
      icon="lock"
      tone="warm"
      title="Нет доступа к этому путешествию"
      body="Возможно, тебя нет в списке участников, приглашение отозвали или путешествие был удалёно."
      primary={{ label: 'К моим путешествиям', onClick: () => nav('/trips') }}
      secondary={{ label: 'Войти другим аккаунтом', onClick: loginOther }}
    />
  );
}
