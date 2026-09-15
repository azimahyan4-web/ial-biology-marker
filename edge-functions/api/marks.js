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
async function callClaudeMark(env, scheme, pages) {
  try {
    const apiKey = await kvGet(env, 'config_apikey');
    if (!apiKey) return { error: 'No Anthropic API key is set.' };

    let system = 'You are an exam marker. You will be given a mark scheme (as an image, PDF, or text) and a student\'s scanned answer pages. Read everything carefully, including handwriting, then grade the answer strictly against the mark scheme, awarding partial credit where the scheme allows it. Work out the maximum possible score from the mark scheme itself. Respond with ONLY a raw JSON object, no markdown or code fences, in this exact shape: {"score": <number>, "max": <number>, "feedback": "<2-4 sentences of constructive feedback written directly to the student>"}';
    if (scheme.guidance) {
      system += '\n\nAdditional marking guidance from the teacher for this specific paper, which takes priority over your own judgement where it conflicts with the printed scheme: ' + scheme.guidance;
    }

    const content = [{ type: 'text', text: 'MARK SCHEME:' }];
    if (scheme.file.kind === 'text') {
      content.push({ type: 'text', text: scheme.file.content });
    } else if (scheme.file.kind === 'pdf') {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: scheme.file.base64 } });
    } else {
      content.push({ type: 'image', source: { type: 'base64', media_type: scheme.file.mediaType, data: scheme.file.base64 } });
    }
    content.push({ type: 'text', text: "STUDENT'S ANSWER (scanned pages, in order):" });
    pages.forEach(p => content.push({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.base64 } }));

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1000, system: system, messages: [{ role: 'user', content: content }] })
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch (e) {}
      return { error: `Claude API error (${res.status})${detail ? ': ' + detail : ''}` };
    }
    const data = await res.json();
    const text = (data.content || []).map(b => b.text || '').join('').trim();
    const clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(clean); } catch (e) { return { error: "Couldn't parse Claude's response." }; }
    const score = Number(parsed.score);
    const max = Number(parsed.max) || 100;
    if (isNaN(score)) return { error: "Claude's response didn't include a usable score." };
    return { score, max, feedback: String(parsed.feedback || '') };
  } catch (e) {
    return { error: 'Unexpected error while marking: ' + (e && e.message ? e.message : String(e)) };
  }
}

export async function onRequest({ request, env }) {
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

    // Try to mark it automatically right away. If there's no scheme yet, or
    // the Claude call fails for any reason, it just stays pending for a
    // teacher to handle manually from "Submissions to mark".
    let autoMarked = false, autoMarkError = null;
    try {
      const scheme = await kvGet(env, schemeKey(year, sessionVal, unit));
      if (!scheme) {
        autoMarkError = 'No mark scheme uploaded yet for this paper — it will stay pending until a teacher adds one.';
      } else {
        const result = await callClaudeMark(env, scheme, pages);
        if (result.error) {
          autoMarkError = result.error;
        } else {
          record.status = 'marked';
          record.score = result.score;
          record.max = result.max;
          record.feedback = result.feedback;
          record.gradedBy = 'Claude (automatic)';
          record.markedByAI = true;
          record.markedDate = new Date().toISOString().slice(0, 10);
          delete record.pages;
          autoMarked = true;
        }
      }
    } catch (e) {
      // Whatever went wrong, the submission itself must still be saved below.
      autoMarkError = 'Unexpected error during automatic marking: ' + (e && e.message ? e.message : String(e));
    }

    try {
      await kvPut(env, id, record);
    } catch (e) {
      return json({ ok: false, error: 'Could not save your submission — please try again.' }, 500);
    }
    return json({ ok: true, autoMarked, autoMarkError });
  }

  if (body.action === 'list') {
    const prefix = actor.role === 'student' ? 'mark_' + keySafe(actor.username) + '_' : 'mark_';
    const rows = await kvList(env, prefix);
    const marks = rows.map(r => { const { pages, ...rest } = r.value; return { id: r.key, ...rest, pageCount: (pages || []).length }; });
    return json({ ok: true, marks });
  }

  if (body.action === 'save') {
    if (actor.role === 'student') return json({ ok: false, error: 'Not authorized.' }, 403);
    const { id, score, max, feedback } = body;
    if (!id || !id.startsWith('mark_')) return json({ ok: false, error: 'Invalid submission id.' }, 400);
    const rec = await kvGet(env, id);
    if (!rec) return json({ ok: false, error: 'Submission not found.' }, 404);
    rec.status = 'marked';
    rec.score = score;
    rec.max = max;
    rec.feedback = feedback;
    rec.gradedBy = actor.username;
    rec.markedByAI = true;
    rec.markedDate = new Date().toISOString().slice(0, 10);
    delete rec.pages;
    await kvPut(env, id, rec);
    return json({ ok: true });
  }

  return json({ ok: false, error: 'Unknown action.' }, 400);
}
