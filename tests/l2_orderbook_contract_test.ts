import {
  assertEquals,
} from "jsr:@std/assert@1";

Deno.test("mcp-v3 exposes real Level-2 orderbook tool", async () => {
  const source =
    await Deno.readTextFile(
      "supabase/functions/mcp-v3/index.ts",
    );

  assertEquals(
    source.includes(
      'name:"l2_orderbook"',
    ),
    true,
  );

  assertEquals(
    source.includes(
      "async function l2OrderBook",
    ),
    true,
  );

  assertEquals(
    source.includes(
      "fetchItickDepth",
    ),
    true,
  );

  assertEquals(
    source.includes(
      "getLevel2OrderBook",
    ),
    true,
  );

  assertEquals(
    source.includes(
      '"itick_api_token"',
    ),
    true,
  );

  assertEquals(
    source.includes(
      "tokenLoader",
    ),
    true,
  );
});
