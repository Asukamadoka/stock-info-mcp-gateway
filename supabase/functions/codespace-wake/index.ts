import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const OWNER = "Asukamadoka";
const REPO = "stock-info-mcp-gateway";
const EXPECTED_REPO_PATH = "/workspaces/stock-info-mcp-gateway";

async function secret(name: string) {
  const rows = await sql`select decrypted_secret from vault.decrypted_secrets where name=${name} limit 1`;
  const value = String(rows?.[0]?.decrypted_secret || "");
  if (!value) throw new Error(`missing secret ${name}`);
  return value;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const auth = req.headers.get("authorization") || "";
    const wakeSecret = await secret("codespace_wake_secret");
    if (auth !== `Bearer ${wakeSecret}`) return json({ error: "unauthorized" }, 401);

    const rows = await sql`
      select endpoint, health, created_at
      from public.codespace_control_registry
      where active=true
      order by created_at desc
      limit 1
    `;
    if (!rows.length) return json({ ok:false, status:"unavailable", error:"no active registry generation" }, 409);

    const row = rows[0] as { endpoint?: unknown; health?: Record<string, unknown> };
    const endpoint = String(row.endpoint || "");
    const health = row.health || {};
    const name = String(health.codespace_name || "");
    if (!/^[A-Za-z0-9-]{10,100}$/.test(name)) {
      return json({ ok:false, status:"unavailable", error:"codespace name unresolved" }, 409);
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const probe = await fetch(`${endpoint}/health`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      clearTimeout(timer);
      if (probe.ok) {
        const h = await probe.json();
        if (h?.ok === true && h?.repo === EXPECTED_REPO_PATH) {
          return json({ ok:true, status:"already_online", head:h.head ?? null, branch:h.branch ?? null });
        }
      }
    } catch {
      // Offline or stale Quick Tunnel; fall through to GitHub Codespaces wake.
    }

    const recent = await sql`
      select created_at
      from public.codespace_wake_events
      where codespace_name=${name}::text
        and created_at > now() - interval '5 minutes'
      order by created_at desc
      limit 1
    `;
    if (recent.length) return json({ ok:true, status:"throttled" });

    const token = await secret("github_pat_stock_info_gateway");
    const res = await fetch(`https://api.github.com/user/codespaces/${encodeURIComponent(name)}/start`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "stock-info-mcp-gateway-wake",
      },
    });
    const text = await res.text();
    if (!res.ok && res.status !== 304) {
      return json({ ok:false, status:"github_error", http_status:res.status, error:text.slice(0,600) }, 502);
    }

    await sql`
      insert into public.codespace_wake_events (codespace_name, repository, github_status)
      values (${name}::text, ${`${OWNER}/${REPO}`}::text, ${res.status}::int)
    `;
    return json({ ok:true, status:"wake_requested", github_status:res.status });
  } catch (e) {
    return json({ ok:false, status:"error", error:e instanceof Error ? e.message : String(e) }, 500);
  }
});
