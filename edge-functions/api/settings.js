function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json' } });
}
function sbHeaders(env) {
  return { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' };
}
async function kvGet(env, key) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/kv_store?key=eq.' + encodeURIComponent(key) + '&select=value', { headers: sbHeaders(env) });
  const rows = await res.json();
  return (Array.isArray(rows) && rows[0]) ? rows[0].value : null;
}
async function kvPut(env, key, value) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/kv_store', {
    method: 'POST',
    headers: Object.assign({}, sbHeaders(env), { Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify({ key, value })
  });
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch (e) {}
    throw new Error('Supabase write failed (' + res.status + '): ' + detail.slice(0, 300));
  }
}
async function findAdmin(env, username, password) {
  if (String(username || '').trim().toLowerCase() !== 'admin') return null;
  const rec = await kvGet(env, 'user_admin');
  return (rec && rec.password === password) ? { role: 'admin', username: 'admin' } : null;
}

export async function onRequest({ request, env }) {
  try {
    return await handleRequest({ request, env });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: 'Unexpected server error: ' + (e && e.message ? e.message : String(e)) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}

async function handleRequest({ request, env }) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid request body.' }, 400); }
  const actor = await findAdmin(env, body.actorUsername, body.actorPassword);
  if (!actor) return json({ ok: false, error: 'Not authorized.' }, 403);

  if (body.action === 'status') {
    const key = await kvGet(env, 'config_apikey');
    return json({ ok: true, isSet: !!key });
  }
  if (body.action === 'set') {
    if (!body.apiKey) return json({ ok: false, error: 'Missing API key.' });
    await kvPut(env, 'config_apikey', body.apiKey);
    return json({ ok: true });
  }
  return json({ ok: false, error: 'Unknown action.' }, 400);
}
