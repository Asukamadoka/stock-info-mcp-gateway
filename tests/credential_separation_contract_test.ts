import { assert } from "jsr:@std/assert";

const MODULES = ["mcp-v3", "mcp-options", "mcp-htsc", "mcp-handoff", "mcp-outcomes"];

Deno.test("every module authenticates through the shared authenticator", async () => {
  for (const m of MODULES) {
    const s = await Deno.readTextFile(`supabase/functions/${m}/index.ts`);
    assert(s.includes("authenticateClient"), `${m} must use the shared authenticator`);
    assert(s.includes("logAuth"), `${m} must log which credential was used`);
  }
});

Deno.test("no module compares an inbound header against the jin10 secret", async () => {
  for (const m of MODULES) {
    const s = await Deno.readTextFile(`supabase/functions/${m}/index.ts`);
    assert(
      !/authorization"\)\s*\|\|\s*""\)\s*[!=]==\s*`Bearer \$\{await (secret|sec|token)/.test(s),
      `${m} still compares an inbound header against a secret directly`,
    );
  }
});

Deno.test("the jin10 credential survives only as an outbound header", async () => {
  const s = await Deno.readTextFile("supabase/functions/mcp-v3/index.ts");
  const lines = s.split("\n").filter((l) => l.includes("jin10_bearer_token"));
  for (const l of lines) {
    assert(
      l.includes("mcp.jin10.com") || l.includes("client_auth:"),
      `jin10_bearer_token outside its outbound role: ${l.trim().slice(0, 100)}`,
    );
  }
});

Deno.test("the legacy window is declared, not implicit", async () => {
  const s = await Deno.readTextFile("supabase/functions/_shared/auth.ts");
  assert(s.includes("LEGACY_CLIENT_TOKEN"), "the legacy credential must be named explicitly");
  assert(s.includes("CLIENT_TOKEN"), "the replacement credential must be named explicitly");
  assert(
    s.includes("constantTimeEqual"),
    "token comparison must not leak length or content by timing",
  );
});
