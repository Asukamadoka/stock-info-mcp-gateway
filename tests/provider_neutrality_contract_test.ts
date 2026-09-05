import { assert } from "jsr:@std/assert";

const CORE = "supabase/functions/mcp-v3/index.ts";

async function core() {
  return await Deno.readTextFile(CORE);
}

Deno.test("no provider is the default handler for tools/call", async () => {
  const s = await core();
  assert(
    !/return jres\(id,await callUpstream\(jin10,"tools\/call"/.test(s),
    "an unrecognised tool name must not fall through to any provider",
  );
  assert(s.includes("routeTool("), "tools/call must route explicitly");
  assert(s.includes("unknown tool"), "an unknown tool must be rejected, not relayed");
});

Deno.test("no provider is the default handler for resources/read", async () => {
  const s = await core();
  assert(
    !/^\s*return jres\(id,await callUpstream\(jin10,"resources\/read",p\)\);$/m.test(s),
    "an unrecognised resource uri must not fall through to any provider",
  );
});

Deno.test("tools/list survives any provider being unavailable", async () => {
  const s = await core();
  assert(s.includes("listAllProviders"), "provider listing must be centralised");
  assert(s.includes("mergeToolLists"), "listings must be merged tolerantly");
  assert(
    !/const j=await callUpstream\(jin10,"tools\/list"/.test(s),
    "tools/list must not await a single provider unguarded",
  );
});

Deno.test("every outbound upstream request is time-boxed", async () => {
  const s = await core();
  assert(s.includes("timeoutSignal("), "rpc must pass an abort signal");
  assert(s.includes("DEFAULT_UPSTREAM_TIMEOUT_MS"), "a default timeout must be defined");
  const fetches = [...s.matchAll(/await fetch\(await up\.url\(\)[^;]*/g)];
  assert(fetches.length > 0, "expected the upstream fetch to be present");
  for (const f of fetches) {
    assert(f[0].includes("signal:"), `upstream fetch without a signal: ${f[0].slice(0, 120)}`);
  }
});

Deno.test("provider listings are cached rather than refetched per request", async () => {
  const s = await core();
  assert(s.includes("ListingCache"), "listings must be cached");
  assert(s.includes("LISTING_TTL_MS"), "the cache must have an explicit TTL");
});

Deno.test("providers are declared as peers in one registry", async () => {
  const s = await core();
  assert(s.includes("const PROVIDERS:Upstream[]"), "providers must live in one list");
  assert(/PROVIDERS:Upstream\[\]=\[jin10,/.test(s), "jin10 must sit in the same list as the others");
});

Deno.test("dead helpers from the fallthrough era are gone", async () => {
  const s = await core();
  for (const dead of ["findHi", "hiTools"]) {
    assert(!s.includes(dead), `${dead} is unreachable and must be removed`);
  }
});
