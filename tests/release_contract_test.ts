import { assertEquals } from "jsr:@std/assert@1";

Deno.test("mcp-v3 is release-ready rather than staging", async () => {
  const s = await Deno.readTextFile(
    "supabase/functions/mcp-v3/index.ts",
  );

  assertEquals(s.includes('const VERSION = "3.1.0";'), true);
  assertEquals(s.includes('status:"ready"'), true);

  assertEquals(s.includes("production_untouched"), false);
  assertEquals(s.includes("3.0.0-staging"), false);
});

Deno.test("CI validates canonical typed source and full test suite", async () => {
  const s = await Deno.readTextFile(
    ".github/workflows/ci.yml",
  );

  assertEquals(
    s.includes("Canonical Source Validation"),
    true,
  );

  assertEquals(
    s.includes("Reject generated snapshot markers"),
    true,
  );

  assertEquals(
    s.includes("deno test --allow-read=."),
    true,
  );

  assertEquals(
    s.includes("20260902011000_option_snapshots.sql"),
    true,
  );

  assertEquals(
    s.includes("Verify reverse-sync markers"),
    false,
  );
});
