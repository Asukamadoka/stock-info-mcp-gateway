import { assert } from "jsr:@std/assert";

Deno.test("Codespace health publishes the current Codespace name", async () => {
  const source = await Deno.readTextFile("scripts/codespace-control-server.py");
  assert(source.includes('"codespace_name":os.environ.get("CODESPACE_NAME")'));
});

Deno.test("wake function is fixed to this repository and not a generic GitHub proxy", async () => {
  const source = await Deno.readTextFile("supabase/functions/codespace-wake/index.ts");
  assert(source.includes('const OWNER = "Asukamadoka"'));
  assert(source.includes('const REPO = "stock-info-mcp-gateway"'));
  assert(source.includes('codespace_wake_secret'));
  assert(source.includes('/start'));
  assert(!source.includes('body.repo'));
  assert(!source.includes('body.codespace'));
});

Deno.test("wake persistence tables are service-only and throttled", async () => {
  const sql = await Deno.readTextFile("supabase/migrations/20260903013000_codespace_wake.sql");
  assert(sql.includes("codespace_wake_events"));
  assert(sql.includes("enable row level security"));
  assert(sql.includes("revoke all on table public.codespace_wake_events from anon, authenticated"));
});

Deno.test("wake source remains read-only with respect to brokerage", async () => {
  const source = await Deno.readTextFile("supabase/functions/codespace-wake/index.ts");
  for (const forbidden of ["ht_submit_order", "ht_cancel_order", "ht_cancel_all_pending_orders", "ht_add_watchlist"]) {
    assert(!source.includes(forbidden));
  }
});
