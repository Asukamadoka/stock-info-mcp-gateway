import { assertEquals } from "jsr:@std/assert@1";

Deno.test("mcp-v3 exposes resilient A-share quote", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/mcp-v3/index.ts",
  );

  assertEquals(source.includes("a_quote_resilient"), true);
  assertEquals(source.includes("runFallback"), true);
  assertEquals(source.includes("parseCnQuoteTimestamp"), true);
  assertEquals(source.includes("quoteResilient"), true);
});
