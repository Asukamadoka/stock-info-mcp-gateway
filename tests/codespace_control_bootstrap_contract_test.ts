import { assert, assertEquals } from "jsr:@std/assert";

Deno.test("codespace control bootstrap is restart-safe and self-registering", async () => {
  const bootstrap = await Deno.readTextFile("scripts/codespace-control-bootstrap.sh");
  const devcontainer = JSON.parse(await Deno.readTextFile(".devcontainer/devcontainer.json"));
  assertEquals(devcontainer.postStartCommand, "bash scripts/codespace-control-bootstrap.sh");
  assert(bootstrap.includes("codespace-control-register"));
  assert(bootstrap.includes("cloudflared tunnel"));
  assert(bootstrap.includes("token_urlsafe"));
  assert(!bootstrap.includes("JIN10_BEARER_TOKEN"));
  assert(!bootstrap.includes("jin10_bearer_token"));
});

Deno.test("fixed-action server exposes no generic exec route", async () => {
  const source = await Deno.readTextFile("scripts/codespace-control-server.py");
  for (const route of ["/release", "/apply-patch", "/cleanup-known-artifact", "/commit-pr"]) assert(source.includes(route));
  assert(!source.includes('"/exec"'));
  assert(!source.includes('"/shell"'));
  assert(!source.includes("ht_submit_order"));
  assert(!source.includes("ht_cancel_order"));
  assert(!source.includes("ht_cancel_all_pending_orders"));
  assert(!source.includes("ht_add_watchlist"));
});

Deno.test("registry migration is not public-readable", async () => {
  const sql = await Deno.readTextFile("supabase/migrations/20260903010000_codespace_control_registry.sql");
  assert(sql.includes("enable row level security"));
  assert(sql.includes("revoke all on table public.codespace_control_registry from anon, authenticated"));
});
