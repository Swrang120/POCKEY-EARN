import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
      status: 405, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) {
    return new Response(JSON.stringify({ error: "SUPABASE_CONFIG_MISSING" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "AUTH_REQUIRED" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await sb.auth.getUser();
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "AUTH_REQUIRED" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const { data, error } = await sb.rpc("start_rewarded_ad");
  if (error) {
    const status = error.message.includes("DAILY_AD_LIMIT_REACHED") ? 429 : 400;
    return new Response(JSON.stringify({ error: error.message }), {
      status, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const row = Array.isArray(data) ? data[0] : data;
  return new Response(JSON.stringify({
    ok: true, ...row, reward_amount: 5,
  }), {
    status: 200, headers: { ...cors, "Content-Type": "application/json" },
  });
});
