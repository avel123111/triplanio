import React from 'react';
import { Crown } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ProBadge({ className, size = 'md' }) {
  const sizeClasses = {
    sm: 'text-[10px] px-1.5 py-0.5',
    md: 'text-xs px-2 py-0.5',
    lg: 'text-sm px-2.5 py-1'
  };

  return (
    <span className={cn(
      'inline-flex items-center gap-1 font-semibold rounded-full bg-orange-100 text-orange-600 dark:bg-orange-950/40 dark:text-orange-300',
      sizeClasses[size],
      className
    )}>
      <Crown className={cn(size === 'sm' ? 'w-3 h-3' : size === 'md' ? 'w-3.5 h-3.5' : 'w-4 h-4')} />
      Pro
    </span>
  );
}