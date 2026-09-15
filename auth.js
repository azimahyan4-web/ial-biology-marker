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
  await fetch(env.SUPABASE_URL + '/rest/v1/kv_store', {
    method: 'POST',
    headers: Object.assign({}, sbHeaders(env), { Prefer: 'resolution=merge-duplicates' }),
    body: JSON.stringify({ key, value })
  });
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

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let body;
  try { body = await request.json(); } catch (e) { return json({ ok: false, error: 'Invalid request body.' }, 400); }
  const { action } = body;

  // First-run bootstrap: make sure the admin account exists.
  let adminRec = await kvGet(env, 'user_admin');
  if (!adminRec) {
    adminRec = { password: 'admin' };
    await kvPut(env, 'user_admin', adminRec);
  }

  if (action === 'login') {
    const actor = await findActor(env, body.username, body.password);
    if (!actor) {
      const uname = keySafe(body.username);
      const known = uname === 'admin'
        || !!(await kvGet(env, 'user_teacher_' + uname))
        || !!(await kvGet(env, 'user_student_' + uname));
      return json({ ok: false, error: known ? 'Incorrect password.' : 'No account found with that username.' });
    }
    return json({ ok: true, role: actor.role, username: actor.username });
  }

  if (action === 'change-password') {
    const actor = await findActor(env, body.username, body.currentPassword);
    if (!actor) return json({ ok: false, error: 'Current password is incorrect.' });
    if (!body.newPassword || body.newPassword.length < 6) return json({ ok: false, error: 'New password must be at least 6 characters.' });
    const key = actor.role === 'admin' ? 'user_admin' : 'user_' + actor.role + '_' + keySafe(actor.username);
    const rec = await kvGet(env, key);
    rec.password = body.newPassword;
    await kvPut(env, key, rec);
    return json({ ok: true });
  }

  if (action === 'give-access') {
    const actor = await findActor(env, body.actorUsername, body.actorPassword);
    if (!actor || actor.role === 'student') return json({ ok: false, error: 'Not authorized.' }, 403);
    if (body.role === 'teacher' && actor.role !== 'admin') return json({ ok: false, error: 'Only admin can add teachers.' }, 403);
    if (!['teacher', 'student'].includes(body.role)) return json({ ok: false, error: 'Invalid role.' }, 400);
    const name = (body.name || '').trim();
    const password = body.password || '';
    if (!name) return json({ ok: false, error: 'Enter a name.' });
    if (password.length < 6) return json({ ok: false, error: 'Password must be at least 6 characters.' });
    const lname = keySafe(name);
    const clash = lname === 'admin'
      || (await kvGet(env, 'user_teacher_' + lname))
      || (await kvGet(env, 'user_student_' + lname));
    if (clash) return json({ ok: false, error: 'That name is already in use by another account.' });
    await kvPut(env, 'user_' + body.role + '_' + lname, { username: name, password });
    return json({ ok: true });
  }

  if (action === 'remove-user') {
    const actor = await findActor(env, body.actorUsername, body.actorPassword);
    if (!actor || actor.role === 'student') return json({ ok: false, error: 'Not authorized.' }, 403);
    if (body.role === 'teacher' && actor.role !== 'admin') return json({ ok: false, error: 'Only admin can remove teachers.' }, 403);
    await kvDelete(env, 'user_' + body.role + '_' + keySafe(body.name));
    return json({ ok: true });
  }

  if (action === 'list-users') {
    const actor = await findActor(env, body.actorUsername, body.actorPassword);
    if (!actor || actor.role === 'student') return json({ ok: false, error: 'Not authorized.' }, 403);
    const teacherRows = await kvList(env, 'user_teacher_');
    const studentRows = await kvList(env, 'user_student_');
    return json({ ok: true, teachers: teacherRows.map(r => r.value.username), students: studentRows.map(r => r.value.username) });
  }

  return json({ ok: false, error: 'Unknown action.' }, 400);
}
