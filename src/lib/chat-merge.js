// Pure merge rule for an incoming realtime chat_messages INSERT.
//
// Kept in its own dependency-free module (same convention as trip-cities.js) so
// `node --test` can exercise it without pulling in the supabase client.
//
// Rules:
//   1. A row we already hold wins — realtime can redeliver.
//   2. The sender's IN-FLIGHT placeholder is replaced by the real row.
//   3. A placeholder whose insert FAILED is kept: it still carries the user's
//      text and its retry action, and dropping it would lose that text silently.
export function mergeIncomingMessage(list = [], msg) {
  if (list.some((m) => m.id === msg.id)) return list;
  return [...list.filter((m) => !(m.__pending && m.user_id === msg.user_id)), msg];
}
