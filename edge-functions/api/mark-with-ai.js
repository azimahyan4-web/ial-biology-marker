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
  if (!actor) return json({ ok: false, error: 'Not authorized.' }, 403);

  const apiKey = await kvGet(env, 'config_apikey');
  if (!apiKey) return json({ ok: false, error: 'No Anthropic API key is set. Add one under Admin \u2192 AI marking settings.' });

  const submission = await kvGet(env, body.id);
  if (!submission || !submission.pages || !submission.pages.length) return json({ ok: false, error: 'Submission not found or has no pages.' }, 404);

  // A student may only trigger marking for their own submission (used by the
  // automatic marking flow); teachers/admin may trigger for anyone's.
  if (actor.role === 'student' && submission.student !== actor.username) return json({ ok: false, error: 'Not authorized.' }, 403);

  const scheme = await kvGet(env, schemeKey(submission.year, submission.session, submission.unit));
  if (!scheme) return json({ ok: false, error: 'No mark scheme found for this paper.' });

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
  submission.pages.forEach(p => content.push({ type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.base64 } }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1000, system: system, messages: [{ role: 'user', content: content }] })
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch (e) {}
    return json({ ok: false, error: `Claude API error (${res.status})${detail ? ': ' + detail : ''}` });
  }
  const data = await res.json();
  const text = (data.content || []).map(b => b.text || '').join('').trim();
  const clean = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(clean); } catch (e) { return json({ ok: false, error: "Couldn't parse Claude's response." }); }
  const score = Number(parsed.score);
  const max = Number(parsed.max) || 100;
  if (isNaN(score)) return json({ ok: false, error: "Claude's response didn't include a usable score." });
  return json({ ok: true, score, max, feedback: String(parsed.feedback || '') });
}
