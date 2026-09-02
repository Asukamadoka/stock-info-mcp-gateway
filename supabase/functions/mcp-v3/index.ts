import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
import {
  parseCnBarTimestamp,
  parseCnQuoteTimestamp,
  runFallback,
} from "./lib/source-result.ts";
import {
  fetchItickDepth,
} from "./lib/level2.ts";
import {
  getLevel2OrderBook,
} from "./lib/level2-service.ts";
import {
  computeIntradaySignals,
  type IntradayBar,
} from "./lib/market-signals.ts";
import {
  computeFundFlowConsensus,
} from "./lib/fund-flow.ts";
import {
  computeCandidateScore,
} from "./lib/candidate-score.ts";
import {
  buildFlowObservations,
  hasCriticalFlowChipData,
  technicalScoreFromIntraday,
} from "./lib/decision-adapters.ts";
import {
  parseTencentQuotePayload,
} from "./lib/tencent.ts";
import { runQmtGatewayTool } from "./lib/qmt-provider.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare:false, max:1 });
const VERSION = "3.2.0";
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
async function tencentQuoteData(a:any){
  const symbol=
    normCode(
      a.code,
      a.market,
    );

  const r=await fetch(
    `https://qt.gtimg.cn/q=${symbol}`,
    {
      headers:{
        Referer:"https://gu.qq.com/",
        "User-Agent":"Mozilla/5.0",
      },
    },
  );

  if(!r.ok){
    throw new Error(
      `Tencent HTTP ${r.status}`,
    );
  }

  const text=
    new TextDecoder("gbk")
      .decode(
        await r.arrayBuffer(),
      );

  return parseTencentQuotePayload(
    text,
    symbol,
  );
}

async function tencentQuote(a:any){
  return wrap(await tencentQuoteData(a));
}

async function tencentKline(a:any){const symbol=normCode(a.code,a.market),period=String(a.period||"m5"),count=Math.max(1,Math.min(Number(a.count||100),320));if(!["m1","m5","m15","m30","m60"].includes(period))throw new Error("bad period");const r=await fetch(`https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${symbol},${period},,${count}`,{headers:{Referer:"https://gu.qq.com/","User-Agent":"Mozilla/5.0"}});const j=await r.json();const rows=j?.data?.[symbol]?.[period];if(!Array.isArray(rows))throw new Error("missing Tencent kline rows");const klines=rows.map((x:any[])=>({time:x?.[0]??null,open:x?.[1]??null,close:x?.[2]??null,high:x?.[3]??null,low:x?.[4]??null,volume_lots:x?.[5]??null,turnover_basis_points:x?.[7]??null,estimated_amount:x?.[5]&&x?.[1]&&x?.[2]?Number(x[5])*100*((Number(x[1])+Number(x[2]))/2):null}));return wrap({source:"tencent",symbol,period,count:klines.length,klines,note:"estimated_amount is estimated; field[7] is turnover basis points"})}
function wrap(data:any){return{content:[{type:"text",text:JSON.stringify(data)}],structuredContent:{data,status:200,message:""}}}
async function optionalSecret(name:string){try{const r=await sql`select decrypted_secret from vault.decrypted_secrets where name=${name} limit 1`;const v=String(r?.[0]?.decrypted_secret||"").trim();return v||null}catch{return null}}
async function qmtConfig(){const url=await optionalSecret("qmt_mcp_url");if(!url)return null;const token=await optionalSecret("qmt_mcp_token");return {url,...(token?{token}:{})}}
async function qmtGateway(name:"qmt_status"|"qmt_quote"|"qmt_option_chain",args:any){return wrap(await runQmtGatewayTool(name,args,{loadConfig:qmtConfig}))}

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

async function quoteResilient(a:any){
  const code=normCode(a.code,a.market);

  const thscode=
    `${code.slice(2)}.${code.startsWith("sh")?"SH":code.startsWith("sz")?"SZ":"BJ"}`;

  const fetchedAt=new Date().toISOString();

  const result=await runFallback<any>([
    {
      source:"tencent-quote",
      sourceFamily:"tencent",
      confidence:0.95,
      maxAgeMs:120_000,

      fetch:async()=>{
        const data=await tencentQuoteData(a);

        return {
          data,
          sourceTimestamp:parseCnQuoteTimestamp(data.time)
        };
      }
    },

    {
      source:"hithink-a-share",
      sourceFamily:"hithink",
      confidence:0.90,
      maxAgeMs:120_000,

      fetch:async()=>{
        const hi=await callUpstream(
          hiA,
          "tools/call",
          {
            name:"get_a_share_prices_snapshot",
            arguments:{thscodes:thscode}
          }
        );

        return {
          data:
            hi?.structuredContent ??
            hi?.content ??
            hi,
          sourceTimestamp:null
        };
      }
    }
  ],fetchedAt);

  return wrap(result);
}

async function l2OrderBook(a:any){
  const symbol=
    normCode(
      a.code,
      a.market,
    );

  if(symbol.startsWith("bj")){
    return wrap({
      source:"itick-depth",
      source_family:"itick",

      source_timestamp:null,
      fetched_at:
        new Date().toISOString(),

      stale:null,
      confidence:0,

      data_kind:"raw",

      status:"unavailable",

      data:null,

      error:
        "Level-2 provider currently supports SH/SZ only; BJ is unavailable",
    });
  }

  const market=
    symbol.startsWith("sh")
      ?"SH"
      :"SZ";

  const result=
    await getLevel2OrderBook({
      code:
        symbol.slice(2),

      market,

      tokenLoader:
        ()=>secret(
          "itick_api_token"
        ),

      depthFetcher:
        ({token,code,market})=>
          fetchItickDepth({
            token,
            code,
            region:market,
          }),
    });

  return wrap(result);
}

function numericBarValue(
  value:any,
):number|null{
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}

async function tencentM5Bars(
  code:string,
  market?:string,
):Promise<{
  symbol:string;
  bars:IntradayBar[];
  sourceTimestamp:string|null;
}>{
  const result=
    await tencentKline({
      code,
      market,
      period:"m5",
      count:80,
    });

  const data=
    result?.structuredContent?.data;

  const rows=
    Array.isArray(data?.klines)
      ?data.klines
      :[];

  const bars:IntradayBar[]=[];

  for(const row of rows){
    const open=
      numericBarValue(row?.open);

    const high=
      numericBarValue(row?.high);

    const low=
      numericBarValue(row?.low);

    const close=
      numericBarValue(row?.close);

    const volume=
      numericBarValue(
        row?.volume_lots,
      );

    const time=
      String(row?.time||"");

    if(
      open===null ||
      high===null ||
      low===null ||
      close===null ||
      volume===null ||
      !time
    ){
      continue;
    }

    bars.push({
      time,
      open,
      high,
      low,
      close,
      volume,
    });
  }

  const last=
    bars.length
      ?bars[bars.length-1]
      :null;

  return {
    symbol:
      String(
        data?.symbol||
        normCode(code,market)
      ),

    bars,

    sourceTimestamp:
      last
        ?parseCnBarTimestamp(
          last.time
        )
        :null,
  };
}

async function intradaySignals(a:any){
  const targetCode=
    String(a?.code||"");

  const targetMarket=
    a?.market
      ?String(a.market)
      :undefined;

  const benchmarkCode=
    String(
      a?.benchmark_code||
      "000300"
    );

  const benchmarkMarket=
    String(
      a?.benchmark_market||
      "sh"
    );

  const fetchedAt=
    new Date().toISOString();

  const [
    target,
    benchmark,
  ]=await Promise.all([
    tencentM5Bars(
      targetCode,
      targetMarket,
    ),

    tencentM5Bars(
      benchmarkCode,
      benchmarkMarket,
    ),
  ]);

  const signals=
    computeIntradaySignals(
      target.bars,
      benchmark.bars,
    );

  const timestamps=[
    target.sourceTimestamp,
    benchmark.sourceTimestamp,
  ].filter(
    (x):x is string=>!!x,
  );

  const sourceTimestamp=
    timestamps.length
      ?timestamps.sort()[0]
      :null;

  let stale:boolean|null=null;

  if(sourceTimestamp){
    const sourceMs=
      Date.parse(
        sourceTimestamp
      );

    const fetchedMs=
      Date.parse(
        fetchedAt
      );

    if(
      Number.isFinite(sourceMs) &&
      Number.isFinite(fetchedMs)
    ){
      stale=
        fetchedMs-sourceMs >
        10*60*1000;
    }
  }

  let confidence=
    sourceTimestamp
      ?0.90
      :0.70;

  if(stale===true){
    confidence=
      Math.min(
        confidence,
        0.55,
      );
  }

  return wrap({
    source:"tencent-m5",
    source_family:"tencent",

    source_timestamp:
      sourceTimestamp,

    fetched_at:
      fetchedAt,

    stale,
    confidence,

    data_kind:"derived",

    target:{
      symbol:target.symbol,
      bar_count:
        target.bars.length,
    },

    benchmark:{
      symbol:
        benchmark.symbol,

      bar_count:
        benchmark.bars.length,
    },

    signals,

    note:
      "VWAP is a 5-minute bar estimate; 15m/30m RS uses matched 5-minute windows. Benchmark defaults to SH 000300 unless explicitly overridden.",
  });
}

async function decisionContext(a:any){
  const intradayWrapped=
    await intradaySignals(a);

  const intraday=
    intradayWrapped
      ?.structuredContent
      ?.data;

  if(
    !intraday?.signals
  ){
    throw new Error(
      "intraday signals unavailable"
    );
  }

  const symbol=
    normCode(
      a.code,
      a.market,
    );

  let l2:any=null;

  if(
    !symbol.startsWith("bj")
  ){
    const market=
      symbol.startsWith("sh")
        ?"SH"
        :"SZ";

    l2=
      await getLevel2OrderBook({
        code:
          symbol.slice(2),

        market,

        tokenLoader:
          ()=>secret(
            "itick_api_token"
          ),

        depthFetcher:
          ({
            token,
            code,
            market,
          })=>
            fetchItickDepth({
              token,
              code,
              region:market,
            }),
      });
  }

  const observations=
    buildFlowObservations({
      signals:
        intraday.signals,

      tencent:{
        confidence:
          Number(
            intraday.confidence||
            0
          ),

        stale:
          intraday.stale ??
          null,
      },

      l2,
    });

  const flow=
    computeFundFlowConsensus(
      observations,
    );

  return {
    intraday,
    l2,
    observations,
    flow,
  };
}

async function fundFlowConsensus(
  a:any,
){
  const ctx=
    await decisionContext(a);

  return wrap({
    source:
      "multi-source-flow-consensus",

    source_families:
      ctx.flow
        .used_observations
        .map(
          (x:any)=>
            x.sourceFamily
        ),

    fetched_at:
      new Date()
        .toISOString(),

    data_kind:
      "derived",

    observations:
      ctx.observations,

    l2_status:
      ctx.l2?.status ??
      "unavailable",

    consensus:
      ctx.flow,

    note:
      "Tencent tail price-volume is an estimate; iTick visible order-book depth is optional. Unknown or unavailable Level-2 is not fabricated.",
  });
}

function boundedScore(
  value:any,
  name:string,
){
  const n=
    Number(value);

  if(
    !Number.isFinite(n) ||
    n<0 ||
    n>100
  ){
    throw new Error(
      `${name} must be between 0 and 100`
    );
  }

  return n;
}

async function candidateScore(
  a:any,
){
  const ctx=
    await decisionContext(a);

  const technical=
    technicalScoreFromIntraday(
      ctx.intraday.signals,
    );

  const candidate=
    computeCandidateScore({
      sectorCatalyst:
        boundedScore(
          a.sector_catalyst_score,
          "sector_catalyst_score",
        ),

      earningsValuation:
        boundedScore(
          a.earnings_valuation_score,
          "earnings_valuation_score",
        ),

      technical:
        technical.score,

      flowChips:
        ctx.flow
          .score_0_to_100,

      payoffTriggers:
        boundedScore(
          a.payoff_triggers_score,
          "payoff_triggers_score",
        ),

      critical1430Available:
        technical
          .critical1430Available,

      flowChipDataAvailable:
        hasCriticalFlowChipData(
          ctx.observations,
        ),

      vetoes:{
        unjustifiedValuation:
          a.unjustified_valuation===
          true,

        relativeWeaknessDespiteCatalyst:
          a.relative_weakness_despite_catalyst===
          true,

        sustainedLargeFundWithdrawal:
          a.sustained_large_fund_withdrawal===
          true,

        cashFlowProfitDivergence:
          a.cash_flow_profit_divergence===
          true,

        majorFundamentalRisk:
          a.major_fundamental_risk===
          true,
      },
    });

  return wrap({
    source:
      "candidate-score-v1",

    fetched_at:
      new Date()
        .toISOString(),

    data_kind:
      "derived",

    candidate,

    auto_inputs:{
      technical,

      fund_flow:
        ctx.flow,

      l2_status:
        ctx.l2?.status ??
        "unavailable",

      intraday_source_timestamp:
        ctx.intraday
          .source_timestamp,

      intraday_stale:
        ctx.intraday.stale,

      intraday_confidence:
        ctx.intraday
          .confidence,
    },

    analyst_inputs:{
      sector_catalyst_score:
        a.sector_catalyst_score,

      earnings_valuation_score:
        a.earnings_valuation_score,

      payoff_triggers_score:
        a.payoff_triggers_score,
    },

    note:
      "Candidate score combines explicit analyst/research scores with automatically derived intraday technical and multi-source flow signals. Hard vetoes override the numeric result.",
  });
}

const LOCAL=[
{name:"qmt_status",description:"Read-only QMT/qmt-mcp capability status. Returns explicit unavailable when the Windows bridge is not configured or usable.",inputSchema:{type:"object",additionalProperties:false}},
{name:"qmt_quote",description:"Read-only QMT current quote snapshot via qmt-mcp qmt_xtdata_snapshot. Freshness remains unknown unless a reliable source timestamp is available; no fake realtime claim.",inputSchema:{type:"object",properties:{codes:{type:"array",items:{type:"string"},minItems:1,maxItems:50},fields:{type:"array",items:{type:"string"}},cache_policy:{type:"string",enum:["prefer","cache_only","live"]}},required:["codes"],additionalProperties:false}},
{name:"qmt_option_chain",description:"Read-only QMT option code chain via qmt-mcp qmt_xtdata_option_chain. Broker entitlement/readiness failures are explicit and never replaced with fabricated contracts.",inputSchema:{type:"object",properties:{underlying:{type:"string"},trade_date:{type:"string"}},required:["underlying"],additionalProperties:false}},
{name:"source_status",description:"Gateway source/auth/deployment status",inputSchema:{type:"object",additionalProperties:false}},
{name:"a_quote_tencent",description:"Tencent A-share realtime quote",inputSchema:{type:"object",properties:{code:{type:"string"},market:{type:"string",enum:["sh","sz","bj"]}},required:["code"],additionalProperties:false}},
{name:"a_kline_tencent",description:"Tencent m1/m5/m15/m30/m60 K-line",inputSchema:{type:"object",properties:{code:{type:"string"},market:{type:"string",enum:["sh","sz","bj"]},period:{type:"string",enum:["m1","m5","m15","m30","m60"]},count:{type:"integer",minimum:1,maximum:320}},required:["code"],additionalProperties:false}},
{name:"a_quote_consensus",description:"Cross-check Tencent realtime quote against HiThink official structured snapshot",inputSchema:{type:"object",properties:{code:{type:"string"},market:{type:"string",enum:["sh","sz","bj"]}},required:["code"],additionalProperties:false}},
{name:"a_quote_resilient",description:"A-share realtime quote with Tencent primary and HiThink fallback. Returns source, freshness, confidence and provider-attempt metadata.",inputSchema:{type:"object",properties:{code:{type:"string"},market:{type:"string",enum:["sh","sz","bj"]}},required:["code"],additionalProperties:false}},
{name:"l2_orderbook",description:"A-share SH/SZ multi-level order book via optional iTick Level-2 provider. Returns visible depth, imbalance, spread and microprice. Missing/expired/quota-limited credentials are reported explicitly and are never replaced by fake Level-2 data.",inputSchema:{type:"object",properties:{code:{type:"string"},market:{type:"string",enum:["sh","sz"]}},required:["code"],additionalProperties:false}},
{name:"a_intraday_signals",description:"A-share 5-minute intraday signal snapshot: estimated bar VWAP, VWAP state, 15m/30m relative strength, and 14:00/14:30 tail-session metrics. Benchmark defaults to CSI 300 (SH 000300) and can be overridden.",inputSchema:{type:"object",properties:{code:{type:"string"},market:{type:"string",enum:["sh","sz","bj"]},benchmark_code:{type:"string"},benchmark_market:{type:"string",enum:["sh","sz","bj"]}},required:["code"],additionalProperties:false}},
{name:"fund_flow_consensus",description:"Multi-source A-share flow consensus. Combines Tencent late-session price-volume proxy with optional iTick visible Level-2 order-book depth, deduplicates source families and exposes conflicts/confidence.",inputSchema:{type:"object",properties:{code:{type:"string"},market:{type:"string",enum:["sh","sz","bj"]},benchmark_code:{type:"string"},benchmark_market:{type:"string",enum:["sh","sz","bj"]}},required:["code"],additionalProperties:false}},
{name:"candidate_score",description:"Transparent short-term candidate score using fixed 25/25/20/20/10 weights. Technical and flow components are auto-derived; sector/catalyst, earnings/valuation and payoff/trigger scores are supplied by research. Missing critical data caps grade at B+ and hard vetoes make the candidate ineligible.",inputSchema:{type:"object",properties:{code:{type:"string"},market:{type:"string",enum:["sh","sz","bj"]},benchmark_code:{type:"string"},benchmark_market:{type:"string",enum:["sh","sz","bj"]},sector_catalyst_score:{type:"number",minimum:0,maximum:100},earnings_valuation_score:{type:"number",minimum:0,maximum:100},payoff_triggers_score:{type:"number",minimum:0,maximum:100},unjustified_valuation:{type:"boolean"},relative_weakness_despite_catalyst:{type:"boolean"},sustained_large_fund_withdrawal:{type:"boolean"},cash_flow_profit_divergence:{type:"boolean"},major_fundamental_risk:{type:"boolean"}},required:["code","sector_catalyst_score","earnings_valuation_score","payoff_triggers_score"],additionalProperties:false}},
{name:"tushare_list_tools",description:"List all TuShare MCP tools without lossy name normalization",inputSchema:{type:"object",additionalProperties:false}},
{name:"tushare_call",description:"Call any TuShare MCP tool by its original tool name",inputSchema:{type:"object",properties:{tool_name:{type:"string"},arguments:{type:"object"}},required:["tool_name"],additionalProperties:false}},
{name:"a_stock_data_capabilities",description:"Inspect integrated simonlin1212/a-stock-data full-skill capability catalog",inputSchema:{type:"object",additionalProperties:false}}
];

async function clientAuth(req:Request){const a=req.headers.get("authorization")||"";return a===`Bearer ${await secret("jin10_bearer_token")}`}
Deno.serve(async(req:Request)=>{
 if(req.method==="GET")return new Response(JSON.stringify({name:"stock-info-mcp-gateway",version:VERSION,status:"ready",source_of_truth:"github"}),{headers:{"content-type":"application/json"}});
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
    if(n==="qmt_status")return jres(id,await qmtGateway("qmt_status",a)); if(n==="qmt_quote")return jres(id,await qmtGateway("qmt_quote",a)); if(n==="qmt_option_chain")return jres(id,await qmtGateway("qmt_option_chain",a)); if(n==="source_status")return jres(id,await sourceStatus()); if(n==="a_quote_tencent")return jres(id,await tencentQuote(a)); if(n==="a_kline_tencent")return jres(id,await tencentKline(a)); if(n==="a_quote_consensus")return jres(id,await quoteConsensus(a)); if(n==="a_quote_resilient")return jres(id,await quoteResilient(a)); if(n==="l2_orderbook")return jres(id,await l2OrderBook(a)); if(n==="a_intraday_signals")return jres(id,await intradaySignals(a)); if(n==="fund_flow_consensus")return jres(id,await fundFlowConsensus(a)); if(n==="candidate_score")return jres(id,await candidateScore(a)); if(n==="tushare_list_tools")return jres(id,wrap(await tushareTools())); if(n==="tushare_call")return jres(id,await callUpstream(tushare,"tools/call",{name:a.tool_name,arguments:a.arguments||{}})); if(n==="a_stock_data_capabilities")return jres(id,await aStockCatalog());
    const hi=await findHi(n); if(hi)return jres(id,await callUpstream(hi.up,"tools/call",{name:hi.name,arguments:a}));
    return jres(id,await callUpstream(jin10,"tools/call",p));
  }
  return jerr(id,-32601,`Method not found: ${String(m)}`);
 }catch(e){console.error(e);return jerr(null,-32603,"Internal error",e instanceof Error?e.message:String(e),500)}
});