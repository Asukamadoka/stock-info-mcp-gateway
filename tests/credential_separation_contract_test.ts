import { assert } from "jsr:@std/assert";

const MODULES = ["mcp-v3", "mcp-options", "mcp-htsc", "mcp-handoff", "mcp-outcomes"];

Deno.test("every module authenticates through the shared authenticator", async () => {
  for (const m of MODULES) {
    const s = await Deno.readTextFile(`supabase/functions/${m}/index.ts`);
    assert(s.includes("authenticateClient"), `${m} must use the shared authenticator`);
  }
});

Deno.test("no module compares an inbound header against a secret directly", async () => {
  for (const m of MODULES) {
    const s = await Deno.readTextFile(`supabase/functions/${m}/index.ts`);
    assert(
      !/authorization"\)\s*\|\|\s*""\)\s*[!=]==\s*`Bearer \$\{await (secret|sec|token|readSecret)/.test(s),
      `${m} still compares an inbound header against a secret directly`,
    );
  }
});

Deno.test("the jin10 credential exists only as an outbound header", async () => {
  for (const m of MODULES) {
    const s = await Deno.readTextFile(`supabase/functions/${m}/index.ts`);
    for (const line of s.split("\n")) {
      if (!line.includes("jin10_bearer_token")) continue;
      assert(
        line.includes("mcp.jin10.com") || line.includes("client_auth:"),
        `${m}: jin10_bearer_token outside its outbound role: ${line.trim().slice(0, 100)}`,
      );
    }
  }
});

Deno.test("there is no compatibility window to forget to close", async () => {
  const s = await Deno.readTextFile("supabase/functions/_shared/auth.ts");
  assert(!s.includes("LEGACY"), "no legacy credential may be accepted");
  assert(!s.includes("DEFAULT_ACCEPTED"), "there is exactly one accepted credential");
  assert(s.includes("CLIENT_TOKEN"), "the credential must be named explicitly");
  assert(s.includes("constantTimeEqual"), "comparison must not leak by timing");
});
