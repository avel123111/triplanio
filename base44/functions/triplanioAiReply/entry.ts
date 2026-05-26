import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Inbound endpoint that n8n calls to deliver the AI assistant's response.
 *
 * Auth: shared bearer token in the Authorization header
 *   `Authorization: Bearer <TRIPLANIO_AI_CALLBACK_SECRET>`
 *
 * Input (POST JSON): { trip_id: string, message: string }
 *
 * Effect: creates a ChatMessage authored by the synthetic Triplanio bot user.
 * The chat UI distinguishes bot messages by user_email === 'ai-assistant@triplanio.bot'
 * and renders the blue robot avatar + bold primary "@Triplanio" mentions.
 */

const BOT_EMAIL = 'info@triplanio.com';
const BOT_NAME = 'Triplanio';

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    // Bearer-token check.
    const expected = Deno.env.get('TRIPLANIO_AI_CALLBACK_SECRET');
    if (!expected) {
      console.error('TRIPLANIO_AI_CALLBACK_SECRET is not set');
      return Response.json({ error: 'Server misconfigured' }, { status: 500 });
    }
    const auth = req.headers.get('authorization') || req.headers.get('Authorization') || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (!m || m[1].trim() !== expected) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { trip_id, message } = await req.json();
    if (!trip_id || typeof message !== 'string' || !message.trim()) {
      return Response.json({ error: 'trip_id and message are required' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const sr = base44.asServiceRole.entities;

    // Verify the trip exists (cheap sanity check; avoids polluting chats with
    // bogus trip ids).
    const trip = await sr.Trip.get(trip_id).catch(() => null);
    if (!trip) {
      return Response.json({ error: 'Trip not found' }, { status: 404 });
    }

    const created = await sr.ChatMessage.create({
      trip_id,
      user_email: BOT_EMAIL,
      user_full_name: BOT_NAME,
      text: message.trim().slice(0, 4000),
    });

    return Response.json({ ok: true, id: created.id });
  } catch (error) {
    console.error('triplanioAiReply error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});