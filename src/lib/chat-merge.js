// Pure merge rule for a chat_messages row arriving from the server: a realtime
// INSERT/UPDATE, or the row returned by the send_chat_message RPC.
//
// Kept in its own dependency-free module (same convention as trip-cities.js) so
// `node --test` can exercise it without pulling in the supabase client.
//
// Rules:
//   1. Same id — the row was UPDATED (the assistant run changed state, or our own
//      row already settled). Replace it in place; realtime can also redeliver.
//   2. Same client_msg_id — this is the server twin of our optimistic row, which
//      carries the id we generated before sending. Replace the placeholder where
//      it stands, so the message does not jump in the list.
//   3. Otherwise — a new row, append.
//
// Matching on client_msg_id (and not on "any in-flight row of this author", as
// before) is what lets two messages sent back to back both survive: the old rule
// dropped EVERY pending row of the sender on the first echo, so the second one
// vanished from the screen until its own echo landed.
export function mergeIncomingMessage(list = [], msg) {
  const at = list.findIndex((m) => m.id === msg.id
    || (!!msg.client_msg_id && m.client_msg_id === msg.client_msg_id));
  if (at === -1) return [...list, msg];
  const next = list.slice();
  next[at] = msg;
  return next;
}
