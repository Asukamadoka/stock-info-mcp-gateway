import { assert, assertStringIncludes } from "jsr:@std/assert";

/**
 * The original form of this test required the literal string
 * `f(HANDOFF,mk(),body)` in the router source. That pinned one call
 * expression rather than the behaviour, so a refactor of tools/list broke it
 * without changing anything a caller can observe.
 *
 * What actually has to hold: the module is declared, handoff_ tool calls route
 * to it, and it takes part in the tools/list fan-out - however that fan-out
 * happens to be written.
 */
function fanoutModules(source: string): string {
  const m = source.match(/Promise\.allSettled\(\[([^\]]*)\]/);
  assert(m, "tools/list must fan out over an explicit module list");
  return m[1];
}

Deno.test("router exposes the handoff MCP route", async () => {
  const text = await Deno.readTextFile("supabase/functions/mcp/index.ts");
  assertStringIncludes(text, "const HANDOFF=");
  assertStringIncludes(text, 'n.startsWith("handoff_")');
  assertStringIncludes(fanoutModules(text), "HANDOFF");
});

Deno.test("router exposes the outcome MCP route", async () => {
  const text = await Deno.readTextFile("supabase/functions/mcp/index.ts");
  assertStringIncludes(text, "const OUTCOMES=");
  assertStringIncludes(text, 'n.startsWith("outcome_")');
  assertStringIncludes(fanoutModules(text), "OUTCOMES");
});

Deno.test("a single unhealthy module cannot empty the tool list", async () => {
  const text = await Deno.readTextFile("supabase/functions/mcp/index.ts");
  assertStringIncludes(text, "Promise.allSettled");
  assert(
    !/Promise\.all\(/.test(text),
    "tools/list must not use a rejecting Promise.all over module fetches",
  );
});
