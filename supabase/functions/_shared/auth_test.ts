import { assert, assertEquals } from "jsr:@std/assert";
import {
  authenticateClient,
  bearerOf,
  CLIENT_TOKEN,
  constantTimeEqual,
  LEGACY_CLIENT_TOKEN,
} from "./auth.ts";

const VAULT: Record<string, string> = {
  [CLIENT_TOKEN]: "new-client-secret",
  [LEGACY_CLIENT_TOKEN]: "old-shared-secret",
};
const reader = (v: Record<string, string>) => async (name: string) => {
  if (!(name in v)) throw new Error(`missing secret ${name}`);
  return v[name];
};
const req = (auth?: string) =>
  new Request("https://example.test", { headers: auth ? { authorization: auth } : {} });

Deno.test("the new client credential authenticates", async () => {
  const r = await authenticateClient(req("Bearer new-client-secret"), reader(VAULT));
  assertEquals(r, { ok: true, source: CLIENT_TOKEN });
});

Deno.test("the legacy shared credential still authenticates during the window", async () => {
  const r = await authenticateClient(req("Bearer old-shared-secret"), reader(VAULT));
  assertEquals(r, { ok: true, source: LEGACY_CLIENT_TOKEN });
});

Deno.test("the new credential not existing yet does not break auth", async () => {
  // This is the state the moment this code ships: gateway_client_token has not
  // been created. Existing callers must keep working.
  const onlyLegacy = { [LEGACY_CLIENT_TOKEN]: "old-shared-secret" };
  const r = await authenticateClient(req("Bearer old-shared-secret"), reader(onlyLegacy));
  assertEquals(r.ok, true);
  assertEquals(r.source, LEGACY_CLIENT_TOKEN);
});

Deno.test("after the window closes the legacy credential is rejected", async () => {
  const r = await authenticateClient(req("Bearer old-shared-secret"), reader(VAULT), [CLIENT_TOKEN]);
  assertEquals(r, { ok: false, source: null });
});

Deno.test("a wrong token is rejected", async () => {
  assertEquals(await authenticateClient(req("Bearer nope"), reader(VAULT)), {
    ok: false,
    source: null,
  });
});

Deno.test("a missing or malformed authorization header is rejected", async () => {
  assertEquals((await authenticateClient(req(), reader(VAULT))).ok, false);
  assertEquals((await authenticateClient(req("new-client-secret"), reader(VAULT))).ok, false);
  assertEquals((await authenticateClient(req("Basic abc"), reader(VAULT))).ok, false);
  assertEquals((await authenticateClient(req("Bearer   "), reader(VAULT))).ok, false);
});

Deno.test("an empty stored secret never authenticates an empty presentation", async () => {
  const r = await authenticateClient(req("Bearer x"), reader({ [CLIENT_TOKEN]: "" }));
  assertEquals(r.ok, false);
});

Deno.test("bearerOf extracts the token and nothing else", () => {
  assertEquals(bearerOf(req("Bearer abc")), "abc");
  assertEquals(bearerOf(req("Bearer  abc  ")), "abc");
  assertEquals(bearerOf(req()), null);
});

Deno.test("comparison is length-safe", () => {
  assert(constantTimeEqual("abc", "abc"));
  assert(!constantTimeEqual("abc", "abcd"));
  assert(!constantTimeEqual("abc", "abd"));
  assert(constantTimeEqual("", ""));
});
