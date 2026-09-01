import { assertEquals } from "jsr:@std/assert@1";

Deno.test("mcp-v3 exposes intraday VWAP RS and tail-session tool", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/mcp-v3/index.ts",
  );

  assertEquals(
    source.includes('name:"a_intraday_signals"'),
    true,
  );

  assertEquals(
    source.includes("computeIntradaySignals"),
    true,
  );

  assertEquals(
    source.includes("async function intradaySignals"),
    true,
  );

  assertEquals(
    source.includes("tencentM5Bars"),
    true,
  );

  assertEquals(
    source.includes("benchmark_code"),
    true,
  );
});
