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
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/kv_store?on_conflict=key', {
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
async function kvList(env, prefix) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/kv_store?key=like.' + encodeURIComponent(prefix) + '*&select=key,value', { headers: sbHeaders(env) });
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}
async function kvListMarksMeta(env, prefix) {
  // Reads from a view that strips the heavy `pages` field server-side, so
  // listing someone's submissions never has to transfer all their scanned
  // images at once — that's what was causing oversized-response failures.
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/kv_marks_meta?key=like.' + encodeURIComponent(prefix) + '*&select=key,value', { headers: sbHeaders(env) });
  if (!res.ok) throw new Error('Could not load results (' + res.status + ').');
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
  if (!actor) return json({ ok: false, error: 'Not authorized.' }, 403);

  if (body.action === 'submit') {
    if (actor.role !== 'student') return json({ ok: false, error: 'Only students can submit.' }, 403);
    const { year, session: sessionVal, unit, question, pages } = body;
    if (!year || !sessionVal || !unit || !pages || !pages.length) return json({ ok: false, error: 'Missing paper details or pages.' });
    const id = 'mark_' + keySafe(actor.username) + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const record = {
      student: actor.username, year, session: sessionVal, unit, question: question || 'Whole paper',
      pages, status: 'pending', score: null, max: null, feedback: null,
      gradedBy: null, markedByAI: false, date: new Date().toISOString().slice(0, 10)
    };
    try {
      await kvPut(env, id, record);
    } catch (e) {
      return json({ ok: false, error: 'Could not save your submission — please try again.' }, 500);
    }
    // This is deliberately just a fast save. Marking is triggered as a
    // separate follow-up call (see /api/mark-with-ai) so a slow Claude
    // response can never risk losing the submission itself.
    return json({ ok: true, id });
  }

  if (body.action === 'list') {
    const prefix = actor.role === 'student' ? 'mark_' + keySafe(actor.username) + '_' : 'mark_';
    const rows = await kvListMarksMeta(env, prefix);
    // The view already excludes `pages`; pageCount isn't available here for
    // pending items, so just report whether pages existed originally isn't
    // tracked — teachers see this via the raw pending record when marking.
    const marks = rows.map(r => ({ id: r.key, ...r.value }));
    return json({ ok: true, marks });
  }

  if (body.action === 'save') {
    const { id, score, max, feedback } = body;
    if (!id || !id.startsWith('mark_')) return json({ ok: false, error: 'Invalid submission id.' }, 400);
    const rec = await kvGet(env, id);
    if (!rec) return json({ ok: false, error: 'Submission not found.' }, 404);
    // Students may only finalize their own submission (used for the automatic
    // marking flow); teachers/admin may finalize anyone's.
    if (actor.role === 'student' && rec.student !== actor.username) return json({ ok: false, error: 'Not authorized.' }, 403);
    rec.status = 'marked';
    rec.score = score;
    rec.max = max;
    rec.feedback = feedback;
    rec.gradedBy = actor.role === 'student' ? 'Claude (automatic)' : actor.username;
    rec.markedByAI = true;
    rec.markedDate = new Date().toISOString().slice(0, 10);
    delete rec.pages;
    await kvPut(env, id, rec);
    return json({ ok: true });
  }

  return json({ ok: false, error: 'Unknown action.' }, 400);
}
