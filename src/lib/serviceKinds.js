// Single source of truth for trip-service styling.
//
// Each service kind (esim / car_rental / insurance) has ONE colour, matching the
// timeline event palette (--ev-*). These tokens are reused everywhere a service
// is shown: the service view/edit dialogs (EventModal / EventEditDialog), the
// "Сервисы" widget cards + ghost-add hovers (ServicesCard) and the add/fork
// modal (ForkPartnerModal). Change a colour here → it changes in every surface.
//
// `icon` is a design-system Icon name (used by the cards). The dialogs render
// their own lucide icon of the same concept (Wifi / Car / ShieldCheck).
export const SERVICE_KINDS = {
  esim: {
    color: 'var(--ev-esim)', soft: 'var(--ev-esim-soft)', ink: 'var(--ev-esim-ink)',
    icon: 'esim', labelKey: 'service.kind.esim', hintKey: 'service.hint.esim',
  },
  car_rental: {
    color: 'var(--ev-car)', soft: 'var(--ev-car-soft)', ink: 'var(--ev-car-ink)',
    icon: 'car', labelKey: 'service.kind.car_rental', hintKey: 'service.hint.car_rental',
  },
  insurance: {
    color: 'var(--ev-insurance)', soft: 'var(--ev-insurance-soft)', ink: 'var(--ev-insurance-ink)',
    icon: 'shield', labelKey: 'service.kind.insurance', hintKey: 'service.hint.insurance',
  },
};

export function serviceKindMeta(kind) {
  return SERVICE_KINDS[kind] || null;
}
