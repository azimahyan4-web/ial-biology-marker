function sbHeaders(env) {
  return { apikey: env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json' };
}
async function kvGet(env, key) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/kv_store?key=eq.' + encodeURIComponent(key) + '&select=value', { headers: sbHeaders(env) });
  const rows = await res.json();
  return (Array.isArray(rows) && rows[0]) ? rows[0].value : null;
}

export async function onRequest({ env }) {
  const out = {};
  try {
    const apiKey = await kvGet(env, 'config_apikey');
    out.hasApiKey = !!apiKey;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey || '',
        'anthropic-version': '2023-06-01',
        'User-Agent': 'Markbook/1.0 (+https://ial-biology-marker.edgeone.dev)',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 20, messages: [{ role: 'user', content: 'Say hi' }] })
    });
    out.status = res.status;
    out.cfRay = res.headers.get('cf-ray');
    out.server = res.headers.get('server');
    const text = await res.text();
    out.bodyPreview = text.slice(0, 1000);
  } catch (e) {
    out.fetchError = e && e.message ? e.message : String(e);
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { 'content-type': 'application/json' } });
}
