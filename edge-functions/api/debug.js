export async function onRequest({ env }) {
  return new Response(JSON.stringify({
    hasSupabaseUrl: !!(env && env.SUPABASE_URL),
    hasSupabaseKey: !!(env && env.SUPABASE_SERVICE_KEY),
    urlPreview: env && env.SUPABASE_URL ? env.SUPABASE_URL.slice(0, 30) : null,
    envKeysSeen: env ? Object.keys(env) : []
  }, null, 2), { headers: { 'content-type': 'application/json' } });
}
