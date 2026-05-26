import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Returns the public Google Maps JavaScript API key for the authenticated user.
// The key is restricted by HTTP referrer in Google Cloud Console, so exposing
// it to the frontend is safe — but we still gate behind auth to discourage
// scraping/abuse.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'GOOGLE_MAPS_API_KEY is not configured' }, { status: 500 });
    }

    return Response.json({ apiKey });
  } catch (error) {
    console.error('getMapsApiKey error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});