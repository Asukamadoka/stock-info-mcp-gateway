import { assert, assertEquals } from "jsr:@std/assert";

const FN = "supabase/functions/mcp-outcomes/index.ts";
const MIGRATION = "supabase/migrations/20260905010000_decision_outcomes.sql";
const ROUTER = "supabase/functions/mcp/index.ts";

Deno.test("mcp-outcomes exposes exactly the three read-and-settle tools", async () => {
  const src = await Deno.readTextFile(FN);
  for (const n of ["outcome_record", "outcome_get", "outcome_scorecard"]) {
    assert(src.includes(`name: "${n}"`), `missing tool ${n}`);
  }
});

Deno.test("mcp-outcomes exposes no trading capability", async () => {
  const src = await Deno.readTextFile(FN);
  for (const forbidden of ["submit_order", "cancel_order", "place_order", "transfer"]) {
    assert(!src.includes(forbidden), `must not expose ${forbidden}`);
  }
});

Deno.test("settlement requires an explicit limit_pct rather than guessing the board", async () => {
  const src = await Deno.readTextFile(FN);
  assert(src.includes("limit_pct required"));
  assert(src.includes('required: ["trading_date", "stage", "subject", "stance", "limit_pct"]'));
});

Deno.test("settlement refuses look-ahead against the handoff cutoff", async () => {
  const src = await Deno.readTextFile(FN);
  assert(src.includes("violatesLookahead"));
  assert(src.includes("look-ahead"));
});

Deno.test("settlement appends a revision instead of overwriting", async () => {
  const src = await Deno.readTextFile(FN);
  assert(src.includes("coalesce(max(revision),0)"));
  assert(!src.toLowerCase().includes("on conflict"), "outcomes must never upsert over a settled row");
});

Deno.test("the migration forbids a settled row without a return", async () => {
  const sql = await Deno.readTextFile(MIGRATION);
  assert(sql.includes("decision_outcomes_settled_has_return"));
  assert(sql.includes("return_pct is not null"));
  assert(sql.includes("return_pct is null"));
});

Deno.test("the outcomes table is service-only", async () => {
  const sql = await Deno.readTextFile(MIGRATION);
  assert(sql.includes("enable row level security"));
  assert(sql.includes("revoke all on table public.decision_outcomes from anon, authenticated"));
});

Deno.test("the router forwards outcome_ calls and tolerates a failing module", async () => {
  const src = await Deno.readTextFile(ROUTER);
  assert(src.includes('startsWith("outcome_")'), "router must route outcome_ tools");
  assert(src.includes("allSettled"), "tools/list must not fail wholesale when one module is down");
});

Deno.test("the scorecard's minimum sample is stated in the tool description", async () => {
  const src = await Deno.readTextFile(FN);
  assert(src.includes("MIN_SAMPLE"));
  assertEquals(src.includes("Reports no statistic at all below"), true);
});
