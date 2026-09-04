import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare:false, max:1 });
const VERSION = "1.0.0";
const PROTOCOL = "2025-11-25";
let secretCache = new Map<string,{v:string,t:number}>();

async function secret(name:string){
  const c=secretCache.get(name);
  if(c && Date.now()-c.t<300000) return c.v;
  const r=await sql`select decrypted_secret from vault.decrypted_secrets where name=${name} limit 1`;
  const v=String(r?.[0]?.decrypted_secret||"");
  if(!v) throw new Error(`missing secret ${name}`);
  secretCache.set(name,{v,t:Date.now()});
  return v;
}
async function auth(req:Request){
  return (req.headers.get("authorization")||"")===`Bearer ${await secret("jin10_bearer_token")}`;
}
function jres(id:unknown,result:unknown,status=200){
  return new Response(JSON.stringify({jsonrpc:"2.0",id,result}),{
    status,headers:{"content-type":"application/json; charset=utf-8"}
  });
}
function jerr(id:unknown,code:number,message:string,status=200){
  return new Response(JSON.stringify({jsonrpc:"2.0",id:id??null,error:{code,message}}),{
    status,headers:{"content-type":"application/json; charset=utf-8"}
  });
}
function wrap(data:unknown){
  return {content:[{type:"text",text:JSON.stringify(data)}],structuredContent:{data,status:200,message:""}};
}
function validDate(s:string){ return /^\d{4}-\d{2}-\d{2}$/.test(s); }
function validStage(s:string){ return ["premarket","midday","tail"].includes(s); }
function ensurePayloadSize(payload:unknown){ const n=new TextEncoder().encode(JSON.stringify(payload)).length; if(n>200_000) throw new Error("payload too large"); }
async function handoffPut(a:any){
  const tradingDate=String(a?.trading_date||""), stage=String(a?.stage||""), generatedAt=String(a?.generated_at||"");
  if(!validDate(tradingDate)) throw new Error("trading_date must be YYYY-MM-DD");
  if(!validStage(stage)) throw new Error("stage must be premarket|midday|tail");
  if(!generatedAt || Number.isNaN(Date.parse(generatedAt))) throw new Error("generated_at must be ISO timestamp");
  if(!a?.payload || typeof a.payload!=="object") throw new Error("payload object required");
  ensurePayloadSize(a.payload);
  const sourceCutoff=a?.source_cutoff && !Number.isNaN(Date.parse(String(a.source_cutoff))) ? String(a.source_cutoff) : null;
  const rows=await sql`insert into public.decision_handoffs (trading_date,stage,generated_at,source_cutoff,payload,schema_version,updated_at) values (${tradingDate}::date,${stage},${generatedAt}::timestamptz,${sourceCutoff}::timestamptz,${sql.json(a.payload)},1,now()) on conflict (trading_date,stage) do update set generated_at=excluded.generated_at,source_cutoff=excluded.source_cutoff,payload=excluded.payload,schema_version=excluded.schema_version,updated_at=now() returning trading_date::text,stage,generated_at,source_cutoff,schema_version,created_at,updated_at`;
  return wrap({status:"ok",source:"stock-info-mcp-gateway",source_family:"internal",source_timestamp:generatedAt,stale:false,confidence:1,data_kind:"derived",record:rows[0]??null});
}
async function handoffGet(a:any){
  const stage=String(a?.stage||""); if(!validStage(stage)) throw new Error("stage must be premarket|midday|tail");
  const tradingDate=a?.trading_date?String(a.trading_date):null; if(tradingDate && !validDate(tradingDate)) throw new Error("trading_date must be YYYY-MM-DD");
  const rows=tradingDate ? await sql`select trading_date::text,stage,generated_at,source_cutoff,payload,schema_version,created_at,updated_at from public.decision_handoffs where trading_date=${tradingDate}::date and stage=${stage} limit 1` : await sql`select trading_date::text,stage,generated_at,source_cutoff,payload,schema_version,created_at,updated_at from public.decision_handoffs where stage=${stage} order by trading_date desc, generated_at desc limit 1`;
  const row=rows[0]??null; return wrap({status:row?"ok":"not_found",source:"stock-info-mcp-gateway",source_family:"internal",source_timestamp:row?.generated_at??null,stale:false,confidence:row?1:0,data_kind:"derived",record:row});
}
async function handoffListDay(a:any){
  const tradingDate=String(a?.trading_date||""); if(!validDate(tradingDate)) throw new Error("trading_date must be YYYY-MM-DD");
  const rows=await sql`select trading_date::text,stage,generated_at,source_cutoff,payload,schema_version,created_at,updated_at from public.decision_handoffs where trading_date=${tradingDate}::date order by case stage when 'premarket' then 1 when 'midday' then 2 else 3 end`;
  return wrap({status:"ok",source:"stock-info-mcp-gateway",source_family:"internal",source_timestamp:rows.length?String(rows[rows.length-1].generated_at):null,stale:false,confidence:rows.length?1:0,data_kind:"derived",records:rows});
}
const TOOLS=[{name:"handoff_put",description:"Persist one stage of the A-share 09:29/11:25/14:45 decision-loop handoff. Service-only storage; does not create market data.",inputSchema:{type:"object",properties:{trading_date:{type:"string"},stage:{type:"string",enum:["premarket","midday","tail"]},generated_at:{type:"string"},source_cutoff:{type:"string"},payload:{type:"object"}},required:["trading_date","stage","generated_at","payload"],additionalProperties:false}},{name:"handoff_get",description:"Read a persisted decision-loop handoff by stage and optional trading date; without trading_date returns latest stage record.",inputSchema:{type:"object",properties:{trading_date:{type:"string"},stage:{type:"string",enum:["premarket","midday","tail"]}},required:["stage"],additionalProperties:false}},{name:"handoff_list_day",description:"Read all persisted premarket/midday/tail handoffs for one trading date.",inputSchema:{type:"object",properties:{trading_date:{type:"string"}},required:["trading_date"],additionalProperties:false}}];
Deno.serve(async(req:Request)=>{
  if(req.method==="GET") return new Response(JSON.stringify({name:"stock-info-mcp-handoff",version:VERSION,status:"ready",source_of_truth:"github"}),{headers:{"content-type":"application/json"}});
  if(req.method!=="POST") return new Response("Method Not Allowed",{status:405});
  try{
    if(!(await auth(req))) return jerr(null,-32001,"Unauthorized",401);
    const b=await req.json(),id=b?.id,m=b?.method,p=b?.params||{};
    if(m==="initialize") return jres(id,{protocolVersion:PROTOCOL,capabilities:{tools:{}},serverInfo:{name:"stock-info-mcp-handoff",version:VERSION}});
    if(m==="notifications/initialized") return new Response(null,{status:202}); if(m==="ping") return jres(id,{}); if(m==="tools/list") return jres(id,{tools:TOOLS});
    if(m==="tools/call"){const n=String(p?.name||""),a=p?.arguments||{};if(n==="handoff_put")return jres(id,await handoffPut(a));if(n==="handoff_get")return jres(id,await handoffGet(a));if(n==="handoff_list_day")return jres(id,await handoffListDay(a));return jerr(id,-32601,"Unknown handoff tool");}
    return jerr(id,-32601,"Method not found");
  }catch(e){ return jerr(null,-32000,e instanceof Error?e.message:String(e)); }
});
