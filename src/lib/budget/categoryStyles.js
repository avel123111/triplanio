/**
 * Palette of icons and colors available for custom budget categories.
 * BudgetCategory stores only the KEY (e.g. icon='utensils', color='amber');
 * lucide components and Tailwind classes are looked up here.
 */
import {
  Folder, Utensils, ShoppingBag, Gift, Coffee, Beer, Music, Ticket,
  MapPin, Heart, Book, Gamepad2, Sparkles, Briefcase, Wifi, Fuel,
} from 'lucide-react';

export const CUSTOM_ICONS = {
  folder:     Folder,
  utensils:   Utensils,
  shopping:   ShoppingBag,
  gift:       Gift,
  coffee:     Coffee,
  beer:       Beer,
  music:      Music,
  ticket:     Ticket,
  pin:        MapPin,
  heart:      Heart,
  book:       Book,
  game:       Gamepad2,
  sparkles:   Sparkles,
  briefcase:  Briefcase,
  wifi:       Wifi,
  fuel:       Fuel,
};

export const CUSTOM_ICON_KEYS = Object.keys(CUSTOM_ICONS);
export const DEFAULT_CUSTOM_ICON = 'folder';

// Literal class strings so Tailwind's scanner picks them up.
export const CUSTOM_COLORS = {
  slate:    'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
  blue:     'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  violet:   'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  emerald:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  amber:    'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  rose:     'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  orange:   'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
  teal:     'bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300',
};

export const CUSTOM_COLOR_DOTS = {
  slate:    'bg-slate-400',
  blue:     'bg-blue-500',
  violet:   'bg-violet-500',
  emerald:  'bg-emerald-500',
  amber:    'bg-amber-500',
  rose:     'bg-rose-500',
  orange:   'bg-orange-500',
  teal:     'bg-teal-500',
};

export const CUSTOM_COLOR_KEYS = Object.keys(CUSTOM_COLORS);
export const DEFAULT_CUSTOM_COLOR = 'slate';

export function resolveCustomCategoryStyle(category) {
  const iconKey = category?.icon && CUSTOM_ICONS[category.icon] ? category.icon : DEFAULT_CUSTOM_ICON;
  const colorKey = category?.color && CUSTOM_COLORS[category.color] ? category.color : DEFAULT_CUSTOM_COLOR;
  return {
    Icon: CUSTOM_ICONS[iconKey],
    colorClass: CUSTOM_COLORS[colorKey],
    iconKey,
    colorKey,
  };
}