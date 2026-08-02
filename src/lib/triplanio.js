// Identity of the Triplanio AI assistant - the only bot mentionable in the trip
// chat. The mention-matching rule itself lives in mention.js (env-free, tested).

// The bot's user_id (uuid) in public.users - per-environment, injected via env.
export const TRIPLANIO_BOT_USER_ID = import.meta.env.VITE_TRIPLANIO_BOT_USER_ID || '';
export const TRIPLANIO_BOT_NAME = 'Triplanio';
