import { createClient } from "npm:@supabase/supabase-js@2.29.0";

Deno.serve(async (req) => {
  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { 'x-client-info': 'edge-function-insert_dummy_data' } }
    });

    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
    }

    const body = await req.json().catch(() => ({}));
    // Only allow created_at field for now; DB will set defaults for others
    const payload: { created_at?: string } = {};
    if (body.created_at) payload.created_at = body.created_at;

    const { data, error } = await supabase.from('dummy_data').insert([payload]).select('id,created_at');
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });

    return new Response(JSON.stringify({ success: true, data }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
