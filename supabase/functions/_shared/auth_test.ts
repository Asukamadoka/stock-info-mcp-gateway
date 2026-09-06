import { assert, assertEquals } from "jsr:@std/assert";
import { authenticateClient, bearerOf, CLIENT_TOKEN, constantTimeEqual } from "./auth.ts";

const reader = (v: Record<string, string>) => async (name: string) => {
  if (!(name in v)) throw new Error(`missing secret ${name}`);
  return v[name];
};
const VAULT = { [CLIENT_TOKEN]: "client-secret" };
const req = (auth?: string) =>
  new Request("https://example.test", { headers: auth ? { authorization: auth } : {} });

Deno.test("the client credential authenticates", async () => {
  assertEquals(await authenticateClient(req("Bearer client-secret"), reader(VAULT)), true);
});

Deno.test("the jin10 credential does not authenticate anything", async () => {
  // The whole point of this module: an upstream's credential is not a door key.
  const vault = { ...VAULT, jin10_bearer_token: "jin10-secret" };
  assertEquals(await authenticateClient(req("Bearer jin10-secret"), reader(vault)), false);
});

Deno.test("a missing client secret rejects rather than passes", async () => {
  assertEquals(await authenticateClient(req("Bearer anything"), reader({})), false);
});

Deno.test("an empty stored secret never authenticates", async () => {
  assertEquals(await authenticateClient(req("Bearer x"), reader({ [CLIENT_TOKEN]: "" })), false);
  assertEquals(await authenticateClient(req("Bearer "), reader({ [CLIENT_TOKEN]: "" })), false);
});

Deno.test("a wrong token is rejected", async () => {
  assertEquals(await authenticateClient(req("Bearer nope"), reader(VAULT)), false);
});

Deno.test("a missing or malformed authorization header is rejected", async () => {
  assertEquals(await authenticateClient(req(), reader(VAULT)), false);
  assertEquals(await authenticateClient(req("client-secret"), reader(VAULT)), false);
  assertEquals(await authenticateClient(req("Basic abc"), reader(VAULT)), false);
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
});
