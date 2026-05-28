// Centralised "what should we show as this person's name?" helper.
//
// Real `full_name` from the user's profile wins. When no name is recorded —
// new users, social logins where no name was returned, members who never
// opened Settings — we fall back to a Title-cased email local-part. That
// reads as a name ("Avel123111") instead of a bare address, which is what
// the rest of the UI assumes when it shows "name on top, email below".
export function displayName(email, fullName) {
  if (fullName && String(fullName).trim()) return String(fullName).trim();
  if (!email) return '—';
  const local = String(email).split('@')[0] || email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}
