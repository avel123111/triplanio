import { toast } from '@/components/ui/use-toast';

// One door for every success toast: a single shared title ("Успех") + a
// per-action subtitle from the `toast` i18n namespace. Keeping the title in one
// place means every success toast in the app stays visually and verbally uniform
// (TRIP-424). Errors/warnings do NOT go through here — they keep their own copy.
/**
 * @param {(key: string, vars?: Record<string, unknown>) => string} t - i18n translator (useT()/useTranslation)
 * @param {string} key - subtitle key under the `toast` namespace, e.g. 'booking_added'
 * @param {Record<string, unknown>} [vars] - interpolation vars for the subtitle (e.g. { city })
 */
export function successToast(t, key, vars) {
  toast({
    variant: 'success',
    title: t('toast.success_title'),
    description: t(`toast.${key}`, vars),
  });
}
