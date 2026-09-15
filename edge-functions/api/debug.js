function sbHeaders(env) {
  return { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' };
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const prefix = url.searchParams.get('prefix') || 'mark_ahyan_';
  const out = { testedPrefix: prefix };
  try {
    const queryUrl = env.SUPABASE_URL + '/rest/v1/kv_store?key=like.' + encodeURIComponent(prefix) + '*&select=key,value';
    out.queryUrl = queryUrl;
    const res = await fetch(queryUrl, { headers: sbHeaders(env) });
    out.status = res.status;
    const text = await res.text();
    out.rawResponseLength = text.length;
    out.rawResponsePreview = text.slice(0, 1000);
    try {
      const parsed = JSON.parse(text);
      out.parsedIsArray = Array.isArray(parsed);
      out.parsedCount = Array.isArray(parsed) ? parsed.length : null;
      out.parsedKeys = Array.isArray(parsed) ? parsed.map(r => r.key) : null;
    } catch (e) {
      out.parseError = e.message;
    }
  } catch (e) {
    out.fetchError = e && e.message ? e.message : String(e);
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { 'content-type': 'application/json' } });
}
