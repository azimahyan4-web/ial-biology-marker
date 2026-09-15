function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json' } });
}
function keySafe(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_');
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
async function kvDelete(env, key) {
  await fetch(env.SUPABASE_URL + '/rest/v1/kv_store?key=eq.' + encodeURIComponent(key), { method: 'DELETE', headers: sbHeaders(env) });
}
async function kvList(env, prefix) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/kv_store?key=like.' + encodeURIComponent(prefix) + '*&select=key,value', { headers: sbHeaders(env) });
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}
async function findActor(env, username, password) {
  const uname = keySafe(username);
  if (uname === 'admin') {
    const rec = await kvGet(env, 'user_admin');
    return (rec && rec.password === password) ? { role: 'admin', username: 'admin' } : null;
  }
  let rec = await kvGet(env, 'user_teacher_' + uname);
  if (rec) return rec.password === password ? { role: 'teacher', username: rec.username } : null;
  rec = await kvGet(env, 'user_student_' + uname);
  if (rec) return rec.password === password ? { role: 'student', username: rec.username } : null;
  return null;
}
function schemeKey(year, sessionVal, unit) {
  return 'scheme_' + year + '_' + keySafe(sessionVal) + '_' + keySafe(unit);
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
  const actor = await findActor(env, body.actorUsername, body.actorPassword);
  if (!actor || actor.role === 'student') return json({ ok: false, error: 'Not authorized.' }, 403);

  if (body.action === 'list') {
    const rows = await kvList(env, 'scheme_');
    return json({ ok: true, schemes: rows.map(r => r.value) });
  }

  if (body.action === 'upsert') {
    const { year, session: sessionVal, unit, file } = body;
    if (!year || !sessionVal || !unit || !file) return json({ ok: false, error: 'Missing year, session, unit or file.' });
    const key = schemeKey(year, sessionVal, unit);
    const existing = await kvGet(env, key);
    const record = { year, session: sessionVal, unit, file, guidance: existing ? existing.guidance : '', createdBy: actor.username, date: new Date().toISOString().slice(0, 10) };
    await kvPut(env, key, record);
    return json({ ok: true });
  }

  if (body.action === 'update-guidance') {
    const { year, session: sessionVal, unit, guidance } = body;
    const key = schemeKey(year, sessionVal, unit);
    const existing = await kvGet(env, key);
    if (!existing) return json({ ok: false, error: 'Scheme not found.' }, 404);
    existing.guidance = guidance || '';
    await kvPut(env, key, existing);
    return json({ ok: true });
  }

  if (body.action === 'remove') {
    const { year, session: sessionVal, unit } = body;
    await kvDelete(env, schemeKey(year, sessionVal, unit));
    return json({ ok: true });
  }

  return json({ ok: false, error: 'Unknown action.' }, 400);
}
