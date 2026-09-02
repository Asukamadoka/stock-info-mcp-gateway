export const QMT_MCP_PROTOCOL_VERSION = "2026-07-28";

export type QmtMcpClientConfig = {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export class QmtMcpError extends Error {
  kind: string;
  status?: number;
  details?: unknown;

  constructor(kind: string, message: string, options: { status?: number; details?: unknown } = {}) {
    super(message);
    this.name = "QmtMcpError";
    this.kind = kind;
    this.status = options.status;
    this.details = options.details;
  }
}

function endpointFor(baseUrl: string): string {
  const raw = baseUrl.trim();
  if (!raw) throw new QmtMcpError("config", "qmt-mcp baseUrl is required");
  const url = new URL(raw);
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname || url.pathname === "/") url.pathname = "/mcp";
  else if (!url.pathname.endsWith("/mcp")) url.pathname += "/mcp";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseSse(text: string): unknown {
  const dataLines = text.split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  for (const line of dataLines) {
    const parsed = parseJson(line);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function kindFromStatus(status: number): string {
  if (status === 401 || status === 403) return "not_authorized";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "capacity";
  return "dependency";
}

function upstreamError(payload: Record<string, unknown>, status?: number): QmtMcpError {
  const kind = typeof payload.error_type === "string" ? payload.error_type : "upstream";
  const message = typeof payload.error === "string" && payload.error ? payload.error : `qmt-mcp ${kind}`;
  return new QmtMcpError(kind, message, { status, details: payload.details });
}

function extractResult(envelope: unknown): unknown {
  if (!envelope || typeof envelope !== "object") {
    throw new QmtMcpError("protocol", "qmt-mcp returned a non-object JSON-RPC envelope");
  }
  const rpc = envelope as Record<string, unknown>;
  if (rpc.error && typeof rpc.error === "object") {
    const e = rpc.error as Record<string, unknown>;
    const data = e.data && typeof e.data === "object" ? e.data as Record<string, unknown> : undefined;
    const kind = typeof data?.error_type === "string" ? data.error_type : "protocol";
    const message = typeof e.message === "string" ? e.message : "qmt-mcp JSON-RPC error";
    throw new QmtMcpError(kind, message, { details: data?.details ?? e.data });
  }
  const result = rpc.result;
  if (!result || typeof result !== "object") {
    throw new QmtMcpError("protocol", "qmt-mcp response is missing result");
  }
  const r = result as Record<string, unknown>;
  let payload: unknown;
  if (r.structuredContent !== undefined) {
    payload = r.structuredContent;
  } else if (Array.isArray(r.content)) {
    const textItem = r.content.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).type === "text") as Record<string, unknown> | undefined;
    if (textItem && typeof textItem.text === "string") {
      payload = parseJson(textItem.text);
    }
  }
  if (payload === undefined) {
    throw new QmtMcpError("protocol", "qmt-mcp success response has no structured content");
  }
  if (payload && typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (p.ok === false || r.isError === true) throw upstreamError(p);
  } else if (r.isError === true) {
    throw new QmtMcpError("upstream", "qmt-mcp tool reported an error");
  }
  return payload;
}

export async function callQmtMcpTool(
  config: QmtMcpClientConfig,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  if (!name.trim()) throw new QmtMcpError("config", "qmt-mcp tool name is required");
  const fetchImpl = config.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? 12_000);
  const requestId = crypto.randomUUID();
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": QMT_MCP_PROTOCOL_VERSION,
    "mcp-method": "tools/call",
    "mcp-name": name,
  });
  if (config.token?.trim()) headers.set("authorization", `Bearer ${config.token.trim()}`);

  try {
    const response = await fetchImpl(endpointFor(config.baseUrl), {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method: "tools/call",
        params: { name, arguments: args, _meta: { request_id: requestId, stateless: true } },
      }),
    });
    const text = await response.text();
    if (!response.ok) {
      const parsed = parseJson(text);
      if (parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>).error_type === "string") {
        throw upstreamError(parsed as Record<string, unknown>, response.status);
      }
      throw new QmtMcpError(kindFromStatus(response.status), `qmt-mcp HTTP ${response.status}`, { status: response.status });
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const envelope = contentType.includes("text/event-stream") ? parseSse(text) : parseJson(text);
    if (envelope === undefined) throw new QmtMcpError("protocol", "qmt-mcp returned an unreadable response");
    return extractResult(envelope);
  } catch (error) {
    if (error instanceof QmtMcpError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new QmtMcpError("timeout", "qmt-mcp request timed out");
    }
    throw new QmtMcpError("dependency", error instanceof Error ? error.message : "qmt-mcp request failed");
  } finally {
    clearTimeout(timer);
  }
}
