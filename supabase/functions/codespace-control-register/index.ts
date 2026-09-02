import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPECTED_REPO = "/workspaces/stock-info-mcp-gateway";
const EXPECTED_SERVICE = "stock-info-mcp-gateway-fixed-control";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body: { host?: string; capability?: string; ttl_minutes?: number };
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const host = String(body.host ?? "").trim().replace(/\/+$/, "");
  const capability = String(body.capability ?? "").trim();
  const ttlMinutes = Math.min(Math.max(Number(body.ttl_minutes ?? 360), 30), 720);

  if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(host)) return json({ error: "invalid_host" }, 400);
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(capability)) return json({ error: "invalid_capability" }, 400);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let health: Record<string, unknown>;
  try {
    const resp = await fetch(`${host}/${capability}/health`, { signal: controller.signal, headers: { accept: "application/json" } });
    clearTimeout(timer);
    if (!resp.ok) return json({ error: "health_probe_failed", status: resp.status }, 400);
    health = await resp.json();
  } catch (e) {
    clearTimeout(timer);
    return json({ error: "health_probe_failed", detail: String(e) }, 400);
  }

  if (health.ok !== true || health.service !== EXPECTED_SERVICE || health.repo !== EXPECTED_REPO) return json({ error: "health_identity_mismatch" }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "server_config" }, 500);
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  const { error: deactivateError } = await supabase.from("codespace_control_registry").update({ active: false }).eq("active", true);
  if (deactivateError) return json({ error: "registry_deactivate_failed", detail: deactivateError.message }, 500);

  const { data, error } = await supabase.from("codespace_control_registry").insert({
    endpoint: `${host}/${capability}`,
    repo: EXPECTED_REPO,
    branch: health.branch ?? null,
    head: health.head ?? null,
    started_at: new Date().toISOString(),
    expires_at: expiresAt,
    health,
    active: true,
  }).select("generation_id, repo, branch, head, started_at, expires_at, active").single();

  if (error) return json({ error: "registry_write_failed", detail: error.message }, 500);
  return json({ ok: true, generation: data });
});
