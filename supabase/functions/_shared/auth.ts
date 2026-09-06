// Inbound authentication for the gateway.
//
// This used to compare the caller's header against `jin10_bearer_token` — the
// same string the gateway sends outbound to mcp.jin10.com on every data
// request. The gateway's own door key therefore travelled to a third party as
// a matter of routine, a leaked read-only data credential granted full tool
// access, and the vendor rotating their token would have taken production auth
// down with it.
//
// Inbound auth is now its own credential and nothing else is accepted. There is
// deliberately no compatibility window: a window is a second code path that
// must be watched, reasoned about and eventually removed, and every one of
// those steps is a chance to leave it in place forever.

export type SecretReader = (name: string) => Promise<string>;

/** The only credential that authenticates a caller. */
export const CLIENT_TOKEN = "gateway_client_token";

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
 * Authenticate an inbound request. Returns false rather than throwing when the
 * secret is missing or unreadable, so a Vault problem is a rejection, never an
 * accidental pass.
 */
export async function authenticateClient(
  req: Request,
  readSecret: SecretReader,
  secretName: string = CLIENT_TOKEN,
): Promise<boolean> {
  const presented = bearerOf(req);
  if (!presented) return false;
  let expected = "";
  try {
    expected = await readSecret(secretName);
  } catch {
    return false;
  }
  return expected.length > 0 && constantTimeEqual(presented, expected);
}
