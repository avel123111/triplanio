import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Settings, LogOut, Crown, Wrench } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useT } from '@/lib/i18n/I18nContext';
import UserAvatar from '@/components/UserAvatar';

export default function UserMenu({ user }) {
  const t = useT();
  const navigate = useNavigate();

  // TODO: replace with Supabase-based subscription check once checkSubscriptionStatus is migrated
  const isPro = false;

  if (!user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-full border border-border bg-background hover:bg-secondary/40 transition px-2 py-2">
          <UserAvatar
            name={user.full_name}
            email={user.email}
            avatarUrl={user.avatar_url}
            size="sm"
            ring={false} />
          <span className="hidden sm:inline text-xs font-medium max-w-[120px] truncate">
            {user.full_name || user.email}
          </span>
          {isPro &&
          <span
            className="inline-flex items-center gap-0.5 mr-1 rounded-md font-bold bg-orange-100 text-orange-600 dark:bg-orange-950/50 dark:text-orange-300 px-1 py-0.5 text-[10px] sm:px-1.5"
            aria-label={t('nav.pro_badge')}
            title={t('nav.pro_badge')}>
              <Crown className="w-2.5 h-2.5" />
              <span className="hidden sm:inline">PRO</span>
            </span>
          }
          {!isPro && <span className="hidden sm:inline-block sm:w-1.5" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5 text-xs text-muted-foreground truncate">{user.email}</div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/settings')}>
          <Settings className="w-4 h-4 mr-2" />{t('nav.settings')}
        </DropdownMenuItem>
        {user.role === 'admin' && (
          <DropdownMenuItem onClick={() => navigate('/admin')}>
            <Wrench className="w-4 h-4 mr-2" />{t('nav.admin_panel')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            await supabase.auth.signOut();
            window.location.href = '/';
          }}
          className="text-destructive focus:text-destructive">
          <LogOut className="w-4 h-4 mr-2" />{t('nav.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}