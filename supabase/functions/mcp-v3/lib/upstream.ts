// Provider registry and routing.
//
// Every upstream is a peer. There is no privileged provider, no "default
// handler", and no path by which an unrecognised tool name reaches a third
// party. Each of those was true of this gateway before this module existed.

export interface UpstreamSpec {
  /** Stable id used in diagnostics and degraded-provider reports. */
  id: string;
  /**
   * Namespace for this provider's tools, e.g. "hithink_a_share__".
   * Empty string means the provider's tools are exposed unprefixed. That is a
   * compatibility affordance for providers that predate namespacing, not a
   * licence to own the whole namespace: an unprefixed name is routed only when
   * the provider has actually declared it (see routeTool).
   */
  prefix: string;
  protocol: string;
  /** Hard ceiling for a single round trip to this provider. */
  timeoutMs: number;
}

export type Route =
  | { kind: "local"; name: string }
  | { kind: "upstream"; providerId: string; name: string }
  | { kind: "unknown"; name: string };

/**
 * Decide where a tool call goes.
 *
 * Precedence, and the reason for each step:
 *
 * 1. Local tools win outright, so an upstream can never shadow one by adding a
 *    tool with a colliding name.
 * 2. An explicit prefix routes to its provider. This is the form new clients
 *    should use.
 * 3. An unprefixed name routes to a provider only if that provider declared it
 *    in its own tools/list. This keeps existing callers working without
 *    handing the unclaimed namespace to anybody.
 * 4. Anything else is unknown and is NOT forwarded. Previously an
 *    unrecognised name fell through to Jin10, which meant caller-controlled
 *    strings left the system through a path nobody designed.
 */
export function routeTool(
  name: string,
  localNames: ReadonlySet<string>,
  providers: readonly UpstreamSpec[],
  declared: ReadonlyMap<string, ReadonlySet<string>>,
): Route {
  if (localNames.has(name)) return { kind: "local", name };

  for (const p of providers) {
    if (p.prefix && name.startsWith(p.prefix)) {
      return { kind: "upstream", providerId: p.id, name: name.slice(p.prefix.length) };
    }
  }

  for (const p of providers) {
    if (declared.get(p.id)?.has(name)) {
      return { kind: "upstream", providerId: p.id, name };
    }
  }

  return { kind: "unknown", name };
}

export interface ProviderListing {
  providerId: string;
  ok: boolean;
  tools: { name: string; [k: string]: unknown }[];
  error?: string;
}

export interface MergedTools {
  tools: { name: string; [k: string]: unknown }[];
  /** Providers that could not be listed. Surfaced, never silently dropped. */
  degraded: { provider: string; error: string }[];
}

/**
 * Merge local tools with whatever upstreams managed to answer.
 *
 * Local tools are always present. A provider that is down costs only its own
 * tools; it cannot empty the list. The previous implementation used a bare
 * Promise.all, so any single failing upstream removed every tool the gateway
 * offered - including tools that touch no upstream at all.
 */
export function mergeToolLists(
  local: readonly { name: string; [k: string]: unknown }[],
  listings: readonly ProviderListing[],
): MergedTools {
  const tools = [...local];
  const seen = new Set(local.map((t) => t.name));
  const degraded: { provider: string; error: string }[] = [];

  for (const l of listings) {
    if (!l.ok) {
      degraded.push({ provider: l.providerId, error: l.error ?? "unavailable" });
      continue;
    }
    for (const t of l.tools) {
      if (!t?.name || seen.has(t.name)) continue;
      seen.add(t.name);
      tools.push(t);
    }
  }
  return { tools, degraded };
}

export function declaredNames(
  listings: readonly ProviderListing[],
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const l of listings) {
    if (!l.ok) continue;
    out.set(l.providerId, new Set(l.tools.map((t) => t.name).filter(Boolean)));
  }
  return out;
}

/**
 * TTL cache for upstream tool listings.
 *
 * Listing every provider costs three sequential round trips each. Doing that
 * on every tools/list is what made the gateway slow enough for a scheduled
 * caller to give up before it answered.
 */
export class ListingCache {
  #entries = new Map<string, { at: number; listing: ProviderListing }>();
  constructor(private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

  get(providerId: string): ProviderListing | null {
    const e = this.#entries.get(providerId);
    if (!e) return null;
    if (this.now() - e.at >= this.ttlMs) return null;
    return e.listing;
  }

  /** Only successful listings are cached; a failure must be retried. */
  set(listing: ProviderListing): void {
    if (!listing.ok) return;
    this.#entries.set(listing.providerId, { at: this.now(), listing });
  }

  clear(): void {
    this.#entries.clear();
  }
}

/** Abort signal for a single outbound request. No call may hang unbounded. */
export function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}
