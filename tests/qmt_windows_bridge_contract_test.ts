import { assert } from "jsr:@std/assert";

Deno.test("Windows QMT bridge bootstrap keeps qmt-mcp loopback-only and secrets out of argv", async()=>{
  const s=await Deno.readTextFile("scripts/windows-qmt-bridge.ps1");
  assert(s.includes("http://127.0.0.1:18765/mcp"));
  assert(s.includes("QMT_MCP_TOKEN"));
  assert(s.includes("QMT_PUBLIC_URL"));
  assert(!s.includes("-Token $env:QMT_MCP_TOKEN"));
  assert(!s.includes("0.0.0.0:18765"));
  assert(!s.includes("ht_submit_order"));
  assert(!s.includes("order_stock"));
});

Deno.test("Windows QMT bridge probes qmt_capabilities locally and remotely before declaring ready", async()=>{
  const s=await Deno.readTextFile("scripts/windows-qmt-bridge.ps1");
  assert(s.includes('qmt_capabilities'));
  assert(s.includes('mcp-protocol-version'));
  assert(s.includes('2026-07-28'));
  assert(s.includes('Invoke-QmtProbe'));
  assert(s.includes('LocalProbe'));
  assert(s.includes('PublicProbe'));
});

Deno.test("production bridge contract requires stable HTTPS and treats quick tunnel as diagnostic only", async()=>{
  const s=await Deno.readTextFile("scripts/windows-qmt-bridge.ps1");
  assert(s.includes('https://'));
  assert(s.includes('trycloudflare.com'));
  assert(s.includes('AllowQuickTunnelForDiagnostic'));
  const d=await Deno.readTextFile("docs/QMT_BRIDGE.md");
  assert(d.includes("127.0.0.1:18765"));
  assert(d.includes("qmt_mcp_url"));
  assert(d.includes("qmt_mcp_token"));
  assert(d.includes("Named Tunnel"));
  assert(d.includes("Quick Tunnel"));
  assert(d.includes("unavailable"));
});

Deno.test("QMT bridge artifacts forbid brokerage mutation", async()=>{
  const text=(await Deno.readTextFile("scripts/windows-qmt-bridge.ps1"))+"\n"+(await Deno.readTextFile("docs/QMT_BRIDGE.md"));
  for(const forbidden of ["ht_submit_order","ht_cancel_order","ht_cancel_all_pending_orders","ht_add_watchlist","qmt_xttrade_order","order_stock","cancel_order_stock"]) assert(!text.includes(forbidden));
});
