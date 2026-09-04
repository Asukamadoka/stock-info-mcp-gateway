import { assertStringIncludes } from "jsr:@std/assert";
Deno.test("router exposes handoff MCP route", async () => {const text=await Deno.readTextFile("supabase/functions/mcp/index.ts");assertStringIncludes(text,'const HANDOFF=');assertStringIncludes(text,'n.startsWith("handoff_")');assertStringIncludes(text,'f(HANDOFF,mk(),body)');});
