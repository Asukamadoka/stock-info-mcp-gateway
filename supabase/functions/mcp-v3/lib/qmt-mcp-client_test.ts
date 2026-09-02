import { assert, assertEquals, assertRejects } from "jsr:@std/assert";
import { callQmtMcpTool, QmtMcpError } from "./qmt-mcp-client.ts";

Deno.test("qmt-mcp call sends stateless 2026 headers and metadata", async () => {
  let seen: Request | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    seen = new Request(input, init);
    return Response.json({ jsonrpc: "2.0", id: "1", result: { structuredContent: { ok: true, price: 12.3 } } });
  };
  const out = await callQmtMcpTool({ baseUrl: "http://127.0.0.1:8000", token: "secret-token", fetchImpl }, "qmt_xtdata_quote", { symbol: "600000.SH" });
  assertEquals(out, { ok: true, price: 12.3 });
  assert(seen);
  assertEquals(seen!.url, "http://127.0.0.1:8000/mcp");
  assertEquals(seen!.headers.get("mcp-protocol-version"), "2026-07-28");
  assertEquals(seen!.headers.get("mcp-method"), "tools/call");
  assertEquals(seen!.headers.get("mcp-name"), "qmt_xtdata_quote");
  assertEquals(seen!.headers.get("authorization"), "Bearer secret-token");
  const body = await seen!.json();
  assertEquals(body.method, "tools/call");
  assertEquals(body.params.name, "qmt_xtdata_quote");
  assertEquals(body.params.arguments.symbol, "600000.SH");
  assert(body.params._meta?.request_id);
});

Deno.test("qmt-mcp call parses SSE JSON-RPC response", async () => {
  const fetchImpl: typeof fetch = async () => new Response(
    'event: message\ndata: {"jsonrpc":"2.0","id":"1","result":{"structuredContent":{"ok":true,"source":"qmt"}}}\n\n',
    { headers: { "content-type": "text/event-stream" } },
  );
  const out = await callQmtMcpTool({ baseUrl: "http://localhost:8000/mcp", fetchImpl }, "qmt_xtdata_quote", {});
  assertEquals(out, { ok: true, source: "qmt" });
});

Deno.test("qmt-mcp call falls back to JSON content text", async () => {
  const fetchImpl: typeof fetch = async () => Response.json({
    jsonrpc: "2.0",
    id: "1",
    result: { content: [{ type: "text", text: '{"ok":true,"value":7}' }] },
  });
  const out = await callQmtMcpTool({ baseUrl: "http://localhost:8000", fetchImpl }, "x", {});
  assertEquals(out, { ok: true, value: 7 });
});

Deno.test("qmt-mcp preserves upstream not_authorized error envelope", async () => {
  const fetchImpl: typeof fetch = async () => Response.json({
    jsonrpc: "2.0",
    id: "1",
    result: { structuredContent: { ok: false, error_type: "not_authorized", error: "VIP entitlement required", details: { scope: "l2" } }, isError: true },
  });
  const err = await assertRejects(() => callQmtMcpTool({ baseUrl: "http://localhost:8000", fetchImpl }, "qmt_l2", {}), QmtMcpError);
  assertEquals(err.kind, "not_authorized");
  assertEquals(err.details, { scope: "l2" });
});

Deno.test("qmt-mcp HTTP auth error never leaks bearer token", async () => {
  const fetchImpl: typeof fetch = async () => new Response("unauthorized", { status: 401 });
  const err = await assertRejects(() => callQmtMcpTool({ baseUrl: "http://localhost:8000", token: "top-secret-bearer", fetchImpl }, "x", {}), QmtMcpError);
  assertEquals(err.kind, "not_authorized");
  assert(!err.message.includes("top-secret-bearer"));
});

Deno.test("qmt-mcp malformed success is a protocol error", async () => {
  const fetchImpl: typeof fetch = async () => Response.json({ jsonrpc: "2.0", id: "1", result: {} });
  const err = await assertRejects(() => callQmtMcpTool({ baseUrl: "http://localhost:8000", fetchImpl }, "x", {}), QmtMcpError);
  assertEquals(err.kind, "protocol");
});
