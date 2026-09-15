export async function onRequest({ env }) {
  const out = {
    hasSupabaseUrl: !!(env && env.SUPABASE_URL),
    hasSupabaseKey: !!(env && env.SUPABASE_SERVICE_KEY),
    urlPreview: env && env.SUPABASE_URL ? env.SUPABASE_URL.slice(0, 40) : null
  };
  try {
    const testUrl = env.SUPABASE_URL + '/rest/v1/kv_store?select=key&limit=1';
    const res = await fetch(testUrl, {
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY,
        'Content-Type': 'application/json'
      }
    });
    out.supabaseCallMade = true;
    out.supabaseStatus = res.status;
    out.supabaseStatusText = res.statusText;
    let bodyText = '';
    try { bodyText = await res.text(); } catch (e) { bodyText = '(could not read body: ' + e.message + ')'; }
    out.supabaseBody = bodyText.slice(0, 500);
  } catch (e) {
    out.supabaseCallMade = false;
    out.fetchError = e && e.message ? e.message : String(e);
    out.fetchErrorName = e && e.name ? e.name : null;
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { 'content-type': 'application/json' } });
}
