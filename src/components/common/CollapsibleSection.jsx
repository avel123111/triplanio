import React from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Sidebar section with persistent collapsed state.
 *
 * Persists the expanded/collapsed state in localStorage under `sidebar-section:<id>`,
 * so the user's choice is preserved across tab switches and reloads.
 *
 * Props:
 * - id (string, required): stable key for localStorage
 * - defaultOpen (bool, default true)
 * - children: section content
 * - header: required ReactNode shown as the trigger (typically the section's own title row)
 */
export default function CollapsibleSection({ id, defaultOpen = true, header, children }) {
  const storageKey = `sidebar-section:${id}`;
  const [open, setOpen] = React.useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === null) return defaultOpen;
      return raw === '1';
    } catch {
      return defaultOpen;
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem(storageKey, open ? '1' : '0');
    } catch { /* ignore */ }
  }, [open, storageKey]);

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden transition-shadow hover:shadow-soft">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 px-5 py-4 hover:bg-secondary/40 transition"
        aria-expanded={open}
      >
        <div className="flex-1 min-w-0 text-left">{header}</div>
        <ChevronDown
          className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && (
        <div className="px-5 pb-5">
          {children}
        </div>
      )}
    </div>
  );
}