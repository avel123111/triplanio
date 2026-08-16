// Backend twin of src/lib/displayName.js — the ONE "what name do we show?" rule,
// kept byte-identical in behaviour so a person reads the same on a trip screen and
// in a notification. Real full_name wins; otherwise a Title-cased email local-part
// ("test8@…" → "Test8") reads as a name instead of a bare address; nothing at all
// → "-". Used server-side so the notification author's DISPLAY name can be resolved
// without ever shipping their raw e-mail to the client (see profiles.toSender).
export function displayName(email: string | null | undefined, fullName: string | null | undefined): string {
  if (fullName && String(fullName).trim()) return String(fullName).trim();
  if (!email) return '-';
  const local = String(email).split('@')[0] || email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}
