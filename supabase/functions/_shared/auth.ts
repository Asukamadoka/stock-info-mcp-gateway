// Inbound authentication for the gateway.
//
// The gateway used to authenticate callers against `jin10_bearer_token` — the
// same string it sends outbound to mcp.jin10.com on every data request. That
// meant the gateway's own door key travelled to a third party, a leak of a
// read-only data credential granted full tool access, and the vendor rotating
// their token would have taken production auth down with it.
//
// This module moves inbound auth onto its own secret while keeping the old one
// accepted, so clients can be cut over without an outage.

export type SecretReader = (name: string) => Promise<string>;

/** The credential clients should present from now on. */
export const CLIENT_TOKEN = "gateway_client_token";

/**
 * Accepted during the migration window only.
 *
 * Removing this is the final step of the cut-over and must not happen before
 * the logs show no caller still presenting it. Every accepted request emits an
 * `auth` log line naming the credential used, so "no traffic on the old value"
 * is an observation rather than an assumption.
 */
export const LEGACY_CLIENT_TOKEN = "jin10_bearer_token";

export const DEFAULT_ACCEPTED: readonly string[] = [CLIENT_TOKEN, LEGACY_CLIENT_TOKEN];

export interface AuthResult {
  ok: boolean;
  /** Which credential matched. Null when unauthenticated. */
  source: string | null;
}

/** Length-safe comparison, so a wrong token cannot be narrowed byte by byte. */
export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export function bearerOf(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length ? token : null;
}

/**
 * Authenticate an inbound request against the accepted credentials, in order.
 *
 * A secret that does not exist yet is skipped rather than fatal: the new
 * credential can be created after this code ships, and the gateway keeps
 * working throughout.
 */
export async function authenticateClient(
  req: Request,
  readSecret: SecretReader,
  accepted: readonly string[] = DEFAULT_ACCEPTED,
): Promise<AuthResult> {
  const presented = bearerOf(req);
  if (!presented) return { ok: false, source: null };

  for (const name of accepted) {
    let value = "";
    try {
      value = await readSecret(name);
    } catch {
      continue; // secret absent or unreadable; try the next
    }
    if (value && constantTimeEqual(presented, value)) return { ok: true, source: name };
  }
  return { ok: false, source: null };
}

/**
 * One structured line per authenticated request, so the cut-over can be
 * observed. Query for source="jin10_bearer_token" to see who has not moved.
 */
export function logAuth(module: string, result: AuthResult): void {
  if (!result.ok) return;
  console.log(JSON.stringify({
    event: "auth",
    module,
    source: result.source,
    legacy: result.source === LEGACY_CLIENT_TOKEN,
  }));
}
