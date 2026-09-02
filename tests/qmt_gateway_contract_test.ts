import { assert, assertEquals } from "jsr:@std/assert";

async function loadProvider(){
  try { return await import("../supabase/functions/mcp-v3/lib/qmt-provider.ts"); }
  catch { assert(false, "qmt-provider module must exist"); throw new Error("unreachable"); }
}

Deno.test("QMT gateway is explicitly unavailable when bridge config is absent", async()=>{
  const m=await loadProvider();
  let called=false;
  const r=await m.runQmtGatewayTool("qmt_status",{}, {loadConfig:async()=>null, callTool:async()=>{called=true;return {};}});
  assertEquals(called,false);
  assertEquals(r.status,"unavailable");
  assertEquals(r.confidence,0);
  assertEquals(r.source_timestamp,null);
  assertEquals(r.stale,null);
  assertEquals(r.data_kind,"raw");
  assertEquals(r.data,null);
});

Deno.test("QMT status maps only to qmt_capabilities", async()=>{
  const m=await loadProvider(); let seen:any=null;
  const r=await m.runQmtGatewayTool("qmt_status",{}, {loadConfig:async()=>({url:"https://qmt.example/mcp",token:"x"}),callTool:async(_c:any,n:string,a:any)=>{seen={n,a};return {ok:true,families:{xtdata:"ready"}};}});
  assertEquals(seen,{n:"qmt_capabilities",a:{}}); assertEquals(r.status,"ok"); assertEquals(r.data_kind,"raw");
});

Deno.test("QMT quote maps exact snapshot arguments", async()=>{
  const m=await loadProvider(); let seen:any=null;
  await m.runQmtGatewayTool("qmt_quote",{codes:["600000.SH"],fields:["lastPrice"],cache_policy:"live"},{loadConfig:async()=>({url:"https://qmt.example/mcp",token:"x"}),callTool:async(_c:any,n:string,a:any)=>{seen={n,a};return {ok:true,data:[]};}});
  assertEquals(seen,{n:"qmt_xtdata_snapshot",a:{codes:["600000.SH"],fields:["lastPrice"],cache_policy:"live"}});
});

Deno.test("QMT option chain maps exact upstream arguments", async()=>{
  const m=await loadProvider(); let seen:any=null;
  await m.runQmtGatewayTool("qmt_option_chain",{underlying:"510050.SH",trade_date:"20260903"},{loadConfig:async()=>({url:"https://qmt.example/mcp",token:"x"}),callTool:async(_c:any,n:string,a:any)=>{seen={n,a};return {ok:true,codes:[]};}});
  assertEquals(seen,{n:"qmt_xtdata_option_chain",a:{underlying:"510050.SH",trade_date:"20260903"}});
});

Deno.test("QMT permission errors remain explicit and never look like neutral data", async()=>{
  const m=await loadProvider();
  const r=await m.runQmtGatewayTool("qmt_quote",{codes:["600000.SH"]},{loadConfig:async()=>({url:"https://qmt.example/mcp",token:"x"}),callTool:async()=>{throw new m.QmtMcpError("not_authorized","scope missing",{scope:"market_data"});}});
  assertEquals(r.status,"permission"); assertEquals(r.confidence,0); assertEquals(r.data,null);
});

Deno.test("QMT raw success without reliable timestamp keeps freshness unknown", async()=>{
  const m=await loadProvider();
  const r=await m.runQmtGatewayTool("qmt_quote",{codes:["600000.SH"]},{loadConfig:async()=>({url:"https://qmt.example/mcp",token:"x"}),callTool:async()=>({ok:true,source:"get_full_tick",data:[{code:"600000.SH",lastPrice:10}]})});
  assertEquals(r.status,"ok"); assertEquals(r.source_timestamp,null); assertEquals(r.stale,null); assertEquals(r.confidence,0.65); assertEquals(r.data_kind,"raw");
});

Deno.test("mcp-v3 exposes only fixed read-only QMT gateway tools", async()=>{
  const source=await Deno.readTextFile("supabase/functions/mcp-v3/index.ts");
  for(const n of ["qmt_status","qmt_quote","qmt_option_chain"]) assert(source.includes('name:"'+n+'"'));
  assert(source.includes('runQmtGatewayTool'));
  assert(!source.includes('qmt_call'));
});
