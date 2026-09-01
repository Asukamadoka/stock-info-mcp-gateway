import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare:false, max:1 });
const VERSION = "3.0.0-staging";
const CLIENT_PROTOCOL = "2025-11-25";

type Upstream = { id:string; url:()=>Promise<string>; headers:()=>Promise<Record<string,string>>; protocol:string; prefix?:string };

let secretCache = new Map<string,{v:string,t:number}>();
async function secret(name:string){
  const c=secretCache.get(name); if(c && Date.now()-c.t<300000) return c.v;
  const r=await sql`select decrypted_secret from vault.decrypted_secrets where name=${name} limit 1`;
  const v=String(r?.[0]?.decrypted_secret||""); if(!v) throw new Error(`missing secret ${name}`);
  secretCache.set(name,{v,t:Date.now()}); return v;
}
function jres(id:unknown,result:unknown,status=200){return new Response(JSON.stringify({jsonrpc:"2.0",id,result}),{status,headers:{"content-type":"application/json; charset=utf-8"}})}
function jerr(id:unknown,code:number,message:string,data?:unknown,status=200){return new Response(JSON.stringify({jsonrpc:"2.0",id:id??null,error:{code,message,...(data===undefined?{}:{data})}}),{status,headers:{"content-type":"application/json; charset=utf-8"}})}
function parseSse(text:string){for(const line of text.split(/\r?\n/)){if(!line.startsWith("data:"))continue;const p=line.slice(5).trim();if(!p||p==="[DONE]")continue;try{return JSON.parse(p)}catch{}}throw new Error("unparseable SSE")}
async function rpc(up:Upstream,body:any,sessionId?:string){
  const h=await up.headers(); h["content-type"]="application/json"; h["accept"]="application/json, text/event-stream"; h["mcp-protocol-version"]=up.protocol; if(sessionId)h["mcp-session-id"]=sessionId;
  const res=await fetch(await up.url(),{method:"POST",headers:h,body:JSON.stringify(body)}); const txt=await res.text();
  if(!res.ok) throw new Error(`${up.id} HTTP ${res.status}: ${txt.slice(0,600)}`);
  const ct=res.headers.get("content-type")||""; const payload=ct.includes("text/event-stream")?parseSse(txt):(txt?JSON.parse(txt):null);
  return {payload,sessionId:res.headers.get("mcp-session-id")||sessionId};
}
async function callUpstream(up:Upstream,method:string,params:any={}){
  const init=await rpc(up,{jsonrpc:"2.0",id:`init-${crypto.randomUUID()}`,method:"initialize",params:{protocolVersion:up.protocol,capabilities:{},clientInfo:{name:"stock-info-mcp-gateway",version:VERSION}}});
  if(init.payload?.error) throw new Error(`${up.id} initialize: ${JSON.stringify(init.payload.error)}`);
  await rpc(up,{jsonrpc:"2.0",method:"notifications/initialized",params:{}},init.sessionId).catch(()=>null);
  const c=await rpc(up,{jsonrpc:"2.0",id:`call-${crypto.randomUUID()}`,method,params},init.sessionId);
  if(c.payload?.error) throw new Error(`${up.id} ${method}: ${JSON.stringify(c.payload.error)}`);
  return c.payload?.result;
}

const jin10:Upstream={id:"jin10",protocol:"2025-11-25",url:async()=>"https://mcp.jin10.com/mcp",headers:async()=>({authorization:`Bearer ${await secret("jin10_bearer_token")}`})};
function hithink(id:string,path:string,prefix:string):Upstream{return{id,protocol:"2025-06-18",prefix,url:async()=>`https://fuyao.aicubes.cn/mcp/${path}`,headers:async()=>({"X-api-key":await secret("hithink_finance_api_key")})}}
const hiA=hithink("hithink-a-share","a-share","hithink_a_share__");
const hiI=hithink("hithink-index","a-share-index","hithink_index__");
const hiF=hithink("hithink-fund","fund","hithink_fund__");
const hiM=hithink("hithink-meta","meta","hithink_meta__");
const tushare:Upstream={id:"tushare",protocol:"2025-11-25",url:async()=>`https://api.tushare.pro/mcp/?token=${encodeURIComponent(await secret("tushare_token"))}`,headers:async()=>({})};
const HI=[hiA,hiI,hiF,hiM];

function normCode(code:string,market?:string){let s=String(code).trim().toLowerCase();if(/^sh\d{6}$/.test(s)||/^sz\d{6}$/.test(s)||/^bj\d{6}$/.test(s))return s;if(/^\d{6}\.(sh|sz|bj)$/.test(s)){const [c,m]=s.split(".");return m+c}if(!/^\d{6}$/.test(s))throw new Error("code must be six digits or exchange-qualified");if(market)return market+s;if(/^(5|6|68)/.test(s))return"sh"+s;if(/^(0|1|2|3)/.test(s))return"sz"+s;if(/^(4|8|92)/.test(s))return"bj"+s;throw new Error("cannot infer market")}
async function tencentQuote(a:any){const symbol=normCode(a.code,a.market);const r=await fetch(`https://qt.gtimg.cn/q=${symbol}`,{headers:{Referer:"https://gu.qq.com/","User-Agent":"Mozilla/5.0"}});const txt=new TextDecoder("gbk").decode(await r.arrayBuffer());const m=txt.match(/="([\s\S]*?)"/);if(!m)throw new Error("bad Tencent quote payload");const f=m[1].split("~");const data={source:"tencent",symbol,code:f[2]||symbol.slice(2),name:f[1]||null,price:f[3]||null,prev_close:f[4]||null,open:f[5]||null,volume:f[6]||null,bid:f[9]||null,ask:f[19]||null,time:f[30]||null,change:f[31]||null,change_percent:f[32]||null,high:f[33]||null,low:f[34]||null,turnover_amount:f[37]||null,turnover_rate:f[38]||null,pe_ttm:f[39]||null};return wrap(data)}
async function tencentKline(a:any){const symbol=normCode(a.code,a.market),period=String(a.period||"m5"),count=Math.max(1,Math.min(Number(a.count||100),320));if(!["m1","m5","m15","m30","m60"].includes(period))throw new Error("bad period");const r=await fetch(`https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${symbol},${period},,${count}`,{headers:{Referer:"https://gu.qq.com/","User-Agent":"Mozilla/5.0"}});const j=await r.json();const rows=j?.data?.[symbol]?.[period];if(!Array.isArray(rows))throw new Error("missing Tencent kline rows");const klines=rows.map((x:any[])=>({time:x?.[0]??null,open:x?.[1]??null,close:x?.[2]??null,high:x?.[3]??null,low:x?.[4]??null,volume_lots:x?.[5]??null,turnover_basis_points:x?.[7]??null,estimated_amount:x?.[5]&&x?.[1]&&x?.[2]?Number(x[5])*100*((Number(x[1])+Number(x[2]))/2):null}));return wrap({source:"tencent",symbol,period,count:klines.length,klines,note:"estimated_amount is estimated; field[7] is turnover basis points"})}
function wrap(data:any){return{content:[{type:"text",text:JSON.stringify(data)}],structuredContent:{data,status:200,message:""}}}

async function hiTools(){const out:any[]=[];for(const up of HI){const r=await callUpstream(up,"tools/list",{});for(const t of r?.tools||[])out.push({...t,name:`${up.prefix}${t.name}`,description:`[${up.id}] ${t.description||t.title||t.name}`})}return out}
async function findHi(prefixed:string){for(const up of HI){if(prefixed.startsWith(up.prefix!))return{up,name:prefixed.slice(up.prefix!.length)}}return null}
async function tushareTools(){return await callUpstream(tushare,"tools/list",{})}
async function aStockSkill(){const r=await fetch("https://raw.githubusercontent.com/simonlin1212/a-stock-data/main/SKILL.md",{headers:{"User-Agent":"stock-info-mcp-gateway"}});if(!r.ok)throw new Error(`a-stock-data SKILL HTTP ${r.status}`);return await r.text()}
async function aStockCatalog(){const txt=await aStockSkill();const heads=[...txt.matchAll(/^###?\s+(.+)$/gm)].map(m=>m[1]).slice(0,200);return wrap({source:"simonlin1212/a-stock-data",integration_mode:"skill-resource+native-adapters",headings:heads,skill_bytes:new TextEncoder().encode(txt).length,worker_status:"python worker pending GitHub integration permission",note:"All skill capabilities are retained as source specification; HTTP-native endpoints are being promoted into first-class tools, Python/TCP endpoints require isolated worker."})}
async function sourceStatus(){
  return wrap({
    gateway:{
      name:"stock-info-mcp-gateway",
      version:VERSION,
      production_router:"mcp",
      core_component:"mcp-v3",
      source_of_truth:"github"
    },
    active:[
      "jin10",
      "tencent",
      "hithink-a-share",
      "hithink-index",
      "hithink-fund",
      "hithink-meta",
      "tushare",
      "a-stock-data-skill",
      "sina-options",
      "htsc"
    ],
    auth:{
      mode:"vault-backed bearer",
      current_client_secret:"jin10_bearer_token"
    },
    principle:"independent upstream domains count as independent votes; wrappers over the same source do not"
  })
}
async function quoteConsensus(a:any){const tq=await tencentQuote(a);const code=normCode(a.code,a.market);const thscode=`${code.slice(2)}.${code.startsWith("sh")?"SH":code.startsWith("sz")?"SZ":"BJ"}`;let hi:any=null,hiErr:any=null;try{hi=await callUpstream(hiA,"tools/call",{name:"get_a_share_prices_snapshot",arguments:{thscodes:thscode}})}catch(e){hiErr=String(e)}return wrap({ticker:thscode,tencent:tq.structuredContent.data,hithink:hi?.structuredContent??hi?.content??hi,error:hiErr,validation:"Compare timestamps and price fields; do not average discrepant sources blindly."})}

const LOCAL=[
{name:"source_status",description:"Gateway source/auth/deployment status",inputSchema:{type:"object",additionalProperties:false}},
{name:"a_quote_tencent",description:"Tencent A-share realtime quote",inputSchema:{type:"object",properties:{code:{type:"string"},market:{type:"string",enum:["sh","sz","bj"]}},required:["code"],additionalProperties:false}},
{name:"a_kline_tencent",description:"Tencent m1/m5/m15/m30/m60 K-line",inputSchema:{type:"object",properties:{code:{type:"string"},market:{type:"string",enum:["sh","sz","bj"]},period:{type:"string",enum:["m1","m5","m15","m30","m60"]},count:{type:"integer",minimum:1,maximum:320}},required:["code"],additionalProperties:false}},
{name:"a_quote_consensus",description:"Cross-check Tencent realtime quote against HiThink official structured snapshot",inputSchema:{type:"object",properties:{code:{type:"string"},market:{type:"string",enum:["sh","sz","bj"]}},required:["code"],additionalProperties:false}},
{name:"tushare_list_tools",description:"List all TuShare MCP tools without lossy name normalization",inputSchema:{type:"object",additionalProperties:false}},
{name:"tushare_call",description:"Call any TuShare MCP tool by its original tool name",inputSchema:{type:"object",properties:{tool_name:{type:"string"},arguments:{type:"object"}},required:["tool_name"],additionalProperties:false}},
{name:"a_stock_data_capabilities",description:"Inspect integrated simonlin1212/a-stock-data full-skill capability catalog",inputSchema:{type:"object",additionalProperties:false}}
];

async function clientAuth(req:Request){const a=req.headers.get("authorization")||"";return a===`Bearer ${await secret("jin10_bearer_token")}`}
Deno.serve(async(req:Request)=>{
 if(req.method==="GET")return new Response(JSON.stringify({name:"stock-info-mcp-gateway",version:VERSION,status:"staging",production_untouched:true}),{headers:{"content-type":"application/json"}});
 if(req.method!=="POST")return new Response("Method Not Allowed",{status:405});
 try{
  if(!(await clientAuth(req)))return jerr(null,-32001,"Unauthorized",undefined,401);
  const b=await req.json(),id=b?.id,m=b?.method,p=b?.params||{};
  if(m==="initialize")return jres(id,{protocolVersion:CLIENT_PROTOCOL,capabilities:{tools:{},resources:{}},serverInfo:{name:"stock-info-mcp-gateway",version:VERSION}});
  if(m==="notifications/initialized")return new Response(null,{status:202}); if(m==="ping")return jres(id,{});
  if(m==="tools/list"){
    const j=await callUpstream(jin10,"tools/list",{}); const hi=await hiTools();
    return jres(id,{tools:[...LOCAL,...hi,...(j?.tools||[])]});
  }
  if(m==="resources/list"){
    let jr:any={resources:[]}; try{jr=await callUpstream(jin10,"resources/list",{})}catch{}
    return jres(id,{resources:[{uri:"a-stock-data://skill",name:"a-stock-data SKILL.md",mimeType:"text/markdown",description:"Live full capability specification from simonlin1212/a-stock-data"},...(jr?.resources||[])]});
  }
  if(m==="resources/read"){
    if(p?.uri==="a-stock-data://skill")return jres(id,{contents:[{uri:p.uri,mimeType:"text/markdown",text:await aStockSkill()}]});
    return jres(id,await callUpstream(jin10,"resources/read",p));
  }
  if(m==="tools/call"){
    const n=String(p?.name||""),a=p?.arguments||{};
    if(n==="source_status")return jres(id,await sourceStatus()); if(n==="a_quote_tencent")return jres(id,await tencentQuote(a)); if(n==="a_kline_tencent")return jres(id,await tencentKline(a)); if(n==="a_quote_consensus")return jres(id,await quoteConsensus(a)); if(n==="tushare_list_tools")return jres(id,wrap(await tushareTools())); if(n==="tushare_call")return jres(id,await callUpstream(tushare,"tools/call",{name:a.tool_name,arguments:a.arguments||{}})); if(n==="a_stock_data_capabilities")return jres(id,await aStockCatalog());
    const hi=await findHi(n); if(hi)return jres(id,await callUpstream(hi.up,"tools/call",{name:hi.name,arguments:a}));
    return jres(id,await callUpstream(jin10,"tools/call",p));
  }
  return jerr(id,-32601,`Method not found: ${String(m)}`);
 }catch(e){console.error(e);return jerr(null,-32603,"Internal error",e instanceof Error?e.message:String(e),500)}
});