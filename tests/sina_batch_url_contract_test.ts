import { assert, assertFalse } from "jsr:@std/assert";

Deno.test("Sina batch quote request preserves literal comma separators", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/mcp-options/index.ts",
  );

  assert(
    source.includes(
      "list=${chunk.join(\",\")}",
    ),
    "batch list URL must preserve literal comma separators between Sina symbols",
  );

  assertFalse(
    source.includes("encodeURIComponent(chunk.join(\",\"))"),
    "encoding comma separators makes Sina treat the whole batch as one symbol",
  );
});
