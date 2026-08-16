import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEdgeTransport } from './edgeTransport.js';

const jsonRes = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// Records the last request so we can assert on URL / method / headers / body.
function recordingFetch(response) {
  const calls = [];
  const doFetch = async (url, init) => {
    calls.push({ url, init, headers: new Headers(init?.headers) });
    return typeof response === 'function' ? response(calls.length) : response;
  };
  return { doFetch, calls };
}

test('2xx → { data: <body>, error: null }', async () => {
  const { doFetch } = recordingFetch(jsonRes(200, { ok: 1, trips: [] }));
  const invoke = createEdgeTransport({ doFetch, getToken: async () => 'JWT' });
  const { data, error } = await invoke('getActiveTrips', { body: {} });
  assert.deepEqual(data, { ok: 1, trips: [] });
  assert.equal(error, null);
});

test('non-2xx → data null, error.context is the raw Response with status + readable body', async () => {
  const { doFetch } = recordingFetch(jsonRes(403, { error: 'нет доступа', code: 'forbidden' }));
  const invoke = createEdgeTransport({ doFetch, getToken: async () => 'JWT' });
  const { data, error } = await invoke('deleteTrip', { body: { id: 't1' } });
  assert.equal(data, null);
  assert.ok(error instanceof Error);
  assert.equal(error.context.status, 403);              // call-sites read this
  assert.match(error.message, /non-2xx/i);              // parseEdgeError filter
  assert.deepEqual(await error.context.json(), { error: 'нет доступа', code: 'forbidden' }); // body unread → readable once
});

test('network/relay failure → error without .context (no Response reached)', async () => {
  const doFetch = async () => { throw new TypeError('Failed to fetch'); };
  const invoke = createEdgeTransport({ doFetch, getToken: async () => 'JWT' });
  const { data, error } = await invoke('getActiveTrips');
  assert.equal(data, null);
  assert.ok(error instanceof Error);
  assert.equal(error.context, undefined);
});

test('signed-in: apikey + Bearer(jwt) headers, subpath kept in url', async () => {
  const { doFetch, calls } = recordingFetch(jsonRes(200, {}));
  const invoke = createEdgeTransport({ doFetch, getToken: async () => 'JWT', apiKey: 'ANON' });
  await invoke('trip-route/city/add', { body: { tripId: 't1' } });
  const { url, headers } = calls[0];
  assert.equal(url, '/api/trip-route/city/add');        // subpath preserved
  assert.equal(headers.get('apikey'), 'ANON');          // public anon key, as the SDK sends it
  assert.equal(headers.get('Authorization'), 'Bearer JWT');
});

test('no session → apikey + Bearer <anon> (SDK-faithful anon fallback)', async () => {
  const { doFetch, calls } = recordingFetch(jsonRes(200, {}));
  const invoke = createEdgeTransport({ doFetch, getToken: async () => null, apiKey: 'ANON' });
  await invoke('getStripePrices', { body: {} });
  assert.equal(calls[0].headers.get('apikey'), 'ANON');
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer ANON');
});

test('getToken throwing does not blow up the call (anon fallback)', async () => {
  const { doFetch, calls } = recordingFetch(jsonRes(200, {}));
  const invoke = createEdgeTransport({ doFetch, getToken: async () => { throw new Error('no session'); }, apiKey: 'ANON' });
  const { error } = await invoke('getActiveTrips');
  assert.equal(error, null);
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer ANON');
});

test('body: object is JSON-serialized; missing body → "{}"', async () => {
  const { doFetch, calls } = recordingFetch(jsonRes(200, {}));
  const invoke = createEdgeTransport({ doFetch, getToken: async () => 'JWT' });
  await invoke('a', { body: { x: 1 } });
  await invoke('b');
  assert.equal(calls[0].init.body, '{"x":1}');
  assert.equal(calls[1].init.body, '{}');               // safer than the SDK's "no body"
});

test('caller headers (e.g. region pin) are forwarded and merged', async () => {
  const { doFetch, calls } = recordingFetch(jsonRes(200, {}));
  const invoke = createEdgeTransport({ doFetch, getToken: async () => 'JWT' });
  await invoke('getTripDetails', { body: {}, headers: { 'x-region': 'fra1' } });
  assert.equal(calls[0].headers.get('x-region'), 'fra1');
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer JWT');
});

test('204 empty body → data null, error null', async () => {
  const { doFetch } = recordingFetch(new Response(null, { status: 204 }));
  const invoke = createEdgeTransport({ doFetch, getToken: async () => 'JWT' });
  const { data, error } = await invoke('inbox/read-all');
  assert.equal(data, null);
  assert.equal(error, null);
});

test('apiBase override', async () => {
  const { doFetch, calls } = recordingFetch(jsonRes(200, {}));
  const invoke = createEdgeTransport({ doFetch, getToken: async () => null, apiBase: '/edge' });
  await invoke('ping');
  assert.equal(calls[0].url, '/edge/ping');
});
