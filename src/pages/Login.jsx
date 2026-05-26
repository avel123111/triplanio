import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { BRAND_NAME, BRAND_LOGO_URL } from '@/lib/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'forgot'
  const [magicSent, setMagicSent] = useState(false);

  // If already authenticated, redirect to home
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        window.location.href = '/';
      }
    });
  }, []);

  const handleGoogle = async () => {
    setIsLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/',
      },
    });
    if (error) {
      setError(error.message);
      setIsLoading(false);
    }
    // On success, browser redirects — no need to reset loading
  };

  const handleEmailPassword = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      if (mode === 'register') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        // After sign-up Supabase sends a confirmation email; redirect will
        // happen automatically via onAuthStateChange in AuthContext once
        // the user confirms (or immediately if email confirmation is off).
        setError(null);
        setMagicSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        // onAuthStateChange in AuthContext will pick up the session and
        // redirect to '/' automatically.
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/reset-password',
      });
      if (error) throw error;
      setMagicSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src={BRAND_LOGO_URL} alt={BRAND_NAME} className="w-14 h-14 rounded-2xl" />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{BRAND_NAME}</h1>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">

          {magicSent ? (
            <div className="text-center space-y-2 py-2">
              <p className="text-sm font-medium text-foreground">
                {mode === 'forgot' ? 'Письмо отправлено' : 'Проверьте почту'}
              </p>
              <p className="text-sm text-muted-foreground">
                {mode === 'forgot'
                  ? `Ссылка для сброса пароля отправлена на ${email}`
                  : `Письмо с подтверждением отправлено на ${email}`}
              </p>
              <button
                type="button"
                onClick={() => { setMagicSent(false); setMode('login'); }}
                className="text-sm text-primary hover:underline mt-2"
              >
                Вернуться к входу
              </button>
            </div>
          ) : (
            <>
              {/* Google */}
              <Button
                type="button"
                variant="outline"
                className="w-full flex items-center gap-2"
                onClick={handleGoogle}
                disabled={isLoading}
              >
                <GoogleIcon />
                Войти через Google
              </Button>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">или</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {/* Email / Password */}
              <form
                onSubmit={mode === 'forgot' ? handleForgotPassword : handleEmailPassword}
                className="space-y-3"
              >
                <div className="space-y-1">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={isLoading}
                  />
                </div>

                {mode !== 'forgot' && (
                  <div className="space-y-1">
                    <Label htmlFor="password">Пароль</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      disabled={isLoading}
                    />
                  </div>
                )}

                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading
                    ? 'Загрузка…'
                    : mode === 'login'
                    ? 'Войти'
                    : mode === 'register'
                    ? 'Создать аккаунт'
                    : 'Отправить ссылку'}
                </Button>
              </form>

              {/* Mode switches */}
              <div className="text-center space-y-1 pt-1">
                {mode === 'login' && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Нет аккаунта?{' '}
                      <button
                        type="button"
                        onClick={() => { setMode('register'); setError(null); }}
                        className="text-primary hover:underline"
                      >
                        Зарегистрироваться
                      </button>
                    </p>
                    <p className="text-sm">
                      <button
                        type="button"
                        onClick={() => { setMode('forgot'); setError(null); }}
                        className="text-muted-foreground hover:underline"
                      >
                        Забыли пароль?
                      </button>
                    </p>
                  </>
                )}
                {(mode === 'register' || mode === 'forgot') && (
                  <button
                    type="button"
                    onClick={() => { setMode('login'); setError(null); }}
                    className="text-sm text-muted-foreground hover:underline"
                  >
                    Вернуться к входу
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
    </svg>
  );
}
