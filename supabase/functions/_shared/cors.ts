export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // Without this, a cross-origin browser caller cannot read Retry-After off a 429
  // response — only CORS-safelisted headers are exposed by default. The geocode
  // proxy (geoLocationiq) emits Retry-After on rate-limit; the client honors it so
  // it never retries before the server has capacity. Additive for every function.
  'Access-Control-Expose-Headers': 'Retry-After',
};
