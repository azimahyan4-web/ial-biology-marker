function sbHeaders(env) {
  return { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' };
}
async function kvGet(env, key) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/kv_store?key=eq.' + encodeURIComponent(key) + '&select=value', { headers: sbHeaders(env) });
  const rows = await res.json();
  return (Array.isArray(rows) && rows[0]) ? rows[0].value : null;
}

export async function onRequest({ request, env }) {
  const out = { step: 'start', method: request.method };
  try {
    out.step = 'parsing body';
    let body = {};
    if (request.method === 'POST') {
      const text = await request.text();
      out.rawBodyLength = text.length;
      body = text ? JSON.parse(text) : {};
    }
    out.bodyReceived = body;

    out.step = 'checking admin';
    const adminRec = await kvGet(env, 'user_admin');
    out.adminRecFound = !!adminRec;

    out.step = 'checking teacher';
    const uname = String(body.username || body.actorUsername || '').toLowerCase();
    const teacherRec = await kvGet(env, 'user_teacher_' + uname);
    out.teacherRecFound = !!teacherRec;

    out.step = 'checking student';
    const studentRec = await kvGet(env, 'user_student_' + uname);
    out.studentRecFound = !!studentRec;

    out.step = 'done';
    out.success = true;
  } catch (e) {
    out.success = false;
    out.errorMessage = e && e.message ? e.message : String(e);
    out.errorName = e && e.name ? e.name : null;
    out.errorStack = e && e.stack ? String(e.stack).slice(0, 800) : null;
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { 'content-type': 'application/json' } });
}
