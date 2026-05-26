import React, { useState } from 'react';
import { Users, Bell, Plus } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Expandable settings panel for the "Hotels Selection" addon.
 * Mock data for now — no backend wiring. Two columns:
 *   - Approvers Management (avatars + name + role + "Add approver")
 *   - Notification Center (list of toggleable notification types)
 */
const MOCK_APPROVERS = [
  { id: 'a1', name: 'Elena Vance', role: 'Team Lead', avatar: 'https://i.pravatar.cc/64?img=47' },
  { id: 'a2', name: 'Markus Wright', role: 'Finance Head', avatar: 'https://i.pravatar.cc/64?img=12' },
];

export default function HotelsSelectionPanel() {
  const t = useT();
  const NOTIFICATIONS = [
    { id: 'price_drop', title: t('trip.notif_price_drop_title'), desc: t('trip.notif_price_drop_desc'), defaultChecked: true },
    { id: 'availability', title: t('trip.notif_availability_title'), desc: t('trip.notif_availability_desc'), defaultChecked: true },
    { id: 'daily', title: t('trip.notif_daily_title'), desc: t('trip.notif_daily_desc'), defaultChecked: false },
  ];

  const [notifState, setNotifState] = useState(
    Object.fromEntries(NOTIFICATIONS.map((n) => [n.id, n.defaultChecked]))
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Approvers */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t('trip.approvers_title')}</h3>
        </div>
        <div className="space-y-3">
          {MOCK_APPROVERS.map((p) => (
            <div key={p.id} className="flex items-center gap-3">
              <img src={p.avatar} alt="" className="w-9 h-9 rounded-full object-cover" />
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{p.name}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{p.role}</div>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/60 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('trip.add_approver')}
          </button>
        </div>
      </div>

      {/* Notifications */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Bell className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{t('trip.notif_center_title')}</h3>
        </div>
        <div className="space-y-3">
          {NOTIFICATIONS.map((n) => (
            <label key={n.id} className="flex items-start gap-3 cursor-pointer">
              <Checkbox
                checked={notifState[n.id]}
                onCheckedChange={(v) => setNotifState((s) => ({ ...s, [n.id]: !!v }))}
                className="mt-0.5"
              />
              <div className="min-w-0">
                <div className="text-sm font-medium">{n.title}</div>
                <p className="text-xs text-muted-foreground leading-snug">{n.desc}</p>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}