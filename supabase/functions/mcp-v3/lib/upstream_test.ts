import { assert, assertEquals } from "jsr:@std/assert";
import {
  declaredNames,
  ListingCache,
  mergeToolLists,
  type ProviderListing,
  routeTool,
  type UpstreamSpec,
} from "./upstream.ts";

const PROVIDERS: UpstreamSpec[] = [
  { id: "hithink-a-share", prefix: "hithink_a_share__", protocol: "2025-06-18", timeoutMs: 8000 },
  { id: "jin10", prefix: "jin10__", protocol: "2025-11-25", timeoutMs: 8000 },
];

const LOCAL = new Set(["a_quote_resilient", "candidate_score"]);

function declaredFor(id: string, names: string[]) {
  return declaredNames([{ providerId: id, ok: true, tools: names.map((name) => ({ name })) }]);
}

Deno.test("an unknown tool name is never forwarded to any provider", () => {
  const r = routeTool("definitely_not_a_tool", LOCAL, PROVIDERS, new Map());
  assertEquals(r.kind, "unknown");
});

Deno.test("local tools take precedence over any upstream", () => {
  const declared = declaredFor("jin10", ["candidate_score"]);
  const r = routeTool("candidate_score", LOCAL, PROVIDERS, declared);
  assertEquals(r, { kind: "local", name: "candidate_score" });
});

Deno.test("an explicit prefix routes to its provider and is stripped", () => {
  const r = routeTool("hithink_a_share__get_prices", LOCAL, PROVIDERS, new Map());
  assertEquals(r, { kind: "upstream", providerId: "hithink-a-share", name: "get_prices" });
});

Deno.test("an unprefixed name routes only if that provider declared it", () => {
  const declared = declaredFor("jin10", ["news_flash"]);
  assertEquals(routeTool("news_flash", LOCAL, PROVIDERS, declared), {
    kind: "upstream",
    providerId: "jin10",
    name: "news_flash",
  });
  assertEquals(routeTool("some_other_name", LOCAL, PROVIDERS, declared).kind, "unknown");
});

Deno.test("when a provider is unreachable its unprefixed names stop resolving", () => {
  // No declarations, because the listing failed. The name must not be relayed
  // on the assumption that the provider probably has it.
  assertEquals(routeTool("news_flash", LOCAL, PROVIDERS, new Map()).kind, "unknown");
});

Deno.test("a failing provider cannot empty the tool list", () => {
  const local = [{ name: "a_quote_resilient" }, { name: "candidate_score" }];
  const listings: ProviderListing[] = [
    { providerId: "jin10", ok: false, tools: [], error: "HTTP 503" },
    { providerId: "hithink-a-share", ok: true, tools: [{ name: "hithink_a_share__get_prices" }] },
  ];
  const merged = mergeToolLists(local, listings);
  assertEquals(merged.tools.length, 3);
  assert(merged.tools.some((t) => t.name === "a_quote_resilient"));
  assertEquals(merged.degraded, [{ provider: "jin10", error: "HTTP 503" }]);
});

Deno.test("every provider failing still leaves the local tools intact", () => {
  const local = [{ name: "a_quote_resilient" }];
  const merged = mergeToolLists(local, [
    { providerId: "jin10", ok: false, tools: [], error: "timeout" },
    { providerId: "hithink-a-share", ok: false, tools: [], error: "timeout" },
  ]);
  assertEquals(merged.tools.map((t) => t.name), ["a_quote_resilient"]);
  assertEquals(merged.degraded.length, 2);
});

Deno.test("an upstream cannot shadow a local tool in the listing", () => {
  const merged = mergeToolLists([{ name: "candidate_score", local: true }], [
    { providerId: "jin10", ok: true, tools: [{ name: "candidate_score", local: false }] },
  ]);
  assertEquals(merged.tools.length, 1);
  assertEquals(merged.tools[0].local, true);
});

Deno.test("degraded providers are reported, not silently dropped", () => {
  const merged = mergeToolLists([], [
    { providerId: "tushare", ok: false, tools: [], error: "HTTP 401" },
  ]);
  assertEquals(merged.degraded, [{ provider: "tushare", error: "HTTP 401" }]);
});

Deno.test("listing cache serves within TTL and expires after it", () => {
  let now = 1000;
  const cache = new ListingCache(5000, () => now);
  const listing: ProviderListing = { providerId: "jin10", ok: true, tools: [{ name: "news_flash" }] };
  cache.set(listing);
  assertEquals(cache.get("jin10")?.tools.length, 1);
  now += 4999;
  assert(cache.get("jin10") !== null);
  now += 2;
  assertEquals(cache.get("jin10"), null);
});

Deno.test("a failed listing is never cached", () => {
  const cache = new ListingCache(5000);
  cache.set({ providerId: "jin10", ok: false, tools: [], error: "boom" });
  assertEquals(cache.get("jin10"), null);
});
