import { assertEquals } from "jsr:@std/assert@1";

Deno.test("source_status reports current gateway state", async () => {
  const source = await Deno.readTextFile(
    "supabase/functions/mcp-v3/index.ts",
  );

  assertEquals(
    source.includes('production_function:"mcp v2 remains untouched"'),
    false,
  );

  assertEquals(
    source.includes('staging_function:"mcp-v3"'),
    false,
  );

  assertEquals(
    source.includes(
      'github_sync:"blocked by GitHub App contents-write permission"',
    ),
    false,
  );

  assertEquals(source.includes("production_router"), true);
  assertEquals(source.includes("source_of_truth"), true);
});
