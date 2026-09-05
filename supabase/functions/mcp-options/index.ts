import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
import {
  computePutPressure,
  type OptionContract,
} from "./lib/put-pressure.ts";
import {
import { authenticateClient, logAuth } from "../_shared/auth.ts";
  previousOpenInterestFromRows,
  toContractSnapshotRows,
} from "./lib/snapshot.ts";
const sql=postgres(Deno.env.get("SUPABASE_DB_URL")!,{prepare:false,max:1});
const VERSION="1.1.0",PROTOCOL="2025-11-25";
const HDR={"Referer":"https://stock.finance.sina.com.cn/","User-Agent":"Mozilla/5.0"};
const secretCache=new Map<string,{v:string,t:number}>();
async function readSecret(name:string){const c=secretCache.get(name);if(c&&Date.now()-c.t<300000)return c.v;const r=await sql`select decrypted_secret from vault.decrypted_secrets where name=${name} limit 1`;const v=String(r?.[0]?.decrypted_secret||"");if(!v)throw new Error(`missing secret ${name}`);secretCache.set(name,{v,t:Date.now()});return v}
function jr(id:any,result:any,status=200){return new Response(JSON.stringify({jsonrpc:"2.0",id,result}),{status,headers:{"content-type":"application/json; charset=utf-8"}})}
function je(id:any,code:number,message:string,data?:any,status=200){return new Response(JSON.stringify({jsonrpc:"2.0",id:id??null,error:{code,message,...(data===undefined?{}:{data})}}),{status,headers:{"content-type":"application/json; charset=utf-8"}})}
function wrap(data:any){return{content:[{type:"text",text:JSON.stringify(data)}],structuredContent:{data,status:200,message:""}}}
function num(x:any){const n=Number(x);return Number.isFinite(n)?n:x}
async function listRaw(param:string){const r=await fetch(`https://hq.sinajs.cn/list=${encodeURIComponent(param)}`,{headers:HDR});if(!r.ok)throw new Error(`Sina HTTP ${r.status}`);const t=new TextDecoder("gbk").decode(await r.arrayBuffer());const m=t.match(/="([\s\S]*?)"/);return m?m[1].split(","):[]}
async function codes(a:any){const underlying=String(a?.underlying||"510050"),call=a?.call!==false;const cate:any={"510050":"50ETF","510300":"300ETF","588000":"科创50ETF","510500":"500ETF"};if(!cate[underlying])throw new Error("underlying must be 510050/510300/588000/510500");const r=await fetch(`https://stock.finance.sina.com.cn/futures/api/openapi.php/StockOptionService.getStockName?exchange=null&cate=${encodeURIComponent(cate[underlying])}`,{headers:HDR});if(!r.ok)throw new Error(`Sina option month HTTP ${r.status}`);const j=await r.json();const months=(j?.result?.data?.contractMonth||[]).slice(1).map((m:string)=>m.replace(/-/g,"").slice(2));const flag=call?"OP_UP_":"OP_DOWN_",out:any={};for(const m of months){const xs=(await listRaw(`${flag}${underlying}${m}`)).filter((x:string)=>x.startsWith("CON_OP_")).map((x:string)=>x.replace("CON_OP_",""));if(xs.length)out[m]=xs}return wrap({source:"sina",underlying,type:call?"call":"put",months:out})}
async function tq(a:any){const code=String(a?.code||"");if(!/^\d+$/.test(code))throw new Error("code required");const v=await listRaw(`CON_OP_${code}`);if(v.length<43)throw new Error("option quote payload too short");return wrap({source:"sina",code,bid_vol:num(v[0]),bid:num(v[1]),last:num(v[2]),ask:num(v[3]),ask_vol:num(v[4]),open_interest:num(v[5]),pct:num(v[6]),strike:num(v[7]),prev_close:num(v[8]),open:num(v[9]),limit_up:num(v[10]),limit_down:num(v[11]),name:v[37],amplitude:num(v[38]),high:num(v[39]),low:num(v[40]),volume:num(v[41]),amount:num(v[42])})}
async function gr(a:any){const code=String(a?.code||"");if(!/^\d+$/.test(code))throw new Error("code required");const raw=await listRaw(`CON_SO_${code}`);if(raw.length<16)throw new Error("option greeks payload too short");const v=[raw[0],...raw.slice(4)];return wrap({source:"sina",code,name:v[0],volume:num(v[1]),delta:num(v[2]),gamma:num(v[3]),theta:num(v[4]),vega:num(v[5]),iv:num(v[6]),high:num(v[7]),low:num(v[8]),trade_code:v[9],strike:num(v[10]),last:num(v[11]),theory:num(v[12])})}

function finiteNum(x:any):number|null{
  const n=Number(x);
  return Number.isFinite(n)?n:null;
}

async function listManyRaw(
  symbols:string[],
  chunkSize=40,
){
  const out=new Map<string,string[]>();

  for(let i=0;i<symbols.length;i+=chunkSize){
    const chunk=symbols.slice(i,i+chunkSize);

    const r=await fetch(
      `https://hq.sinajs.cn/list=${chunk.join(",")}`,
      {headers:HDR},
    );

    if(!r.ok){
      throw new Error(`Sina batch HTTP ${r.status}`);
    }

    const text=new TextDecoder("gbk").decode(
      await r.arrayBuffer(),
    );

    const re=/var hq_str_([^=]+)="([\s\S]*?)";/g;

    for(const match of text.matchAll(re)){
      const symbol=match[1];
      const body=match[2];

      out.set(
        symbol,
        body ? body.split(",") : [],
      );
    }
  }

  return out;
}

async function optionCodeMonths(
  underlying:string,
  side:"call"|"put",
){
  const cate:Record<string,string>={
    "510050":"50ETF",
    "510300":"300ETF",
    "588000":"科创50ETF",
    "510500":"500ETF",
  };

  if(!cate[underlying]){
    throw new Error(
      "underlying must be 510050/510300/588000/510500",
    );
  }

  const r=await fetch(
    "https://stock.finance.sina.com.cn/futures/api/openapi.php/" +
    "StockOptionService.getStockName" +
    `?exchange=null&cate=${encodeURIComponent(cate[underlying])}`,
    {headers:HDR},
  );

  if(!r.ok){
    throw new Error(
      `Sina option month HTTP ${r.status}`,
    );
  }

  const j=await r.json();

  const months:string[]=
    (j?.result?.data?.contractMonth||[])
      .slice(1)
      .map((m:string)=>
        m.replace(/-/g,"").slice(2)
      );

  const prefix=
    side==="call"
      ?"OP_UP_"
      :"OP_DOWN_";

  const result:Record<string,string[]>={};

  for(const month of months){
    const raw=await listRaw(
      `${prefix}${underlying}${month}`,
    );

    const codes=raw
      .filter((x:string)=>
        x.startsWith("CON_OP_")
      )
      .map((x:string)=>
        x.replace("CON_OP_","")
      );

    if(codes.length){
      result[month]=codes;
    }
  }

  return result;
}

function optionContractFromRaw(
  code:string,
  side:"call"|"put",
  quote:string[]|undefined,
  greekRaw:string[]|undefined,
):OptionContract|null{
  if(!quote || quote.length<43){
    return null;
  }

  const strike=finiteNum(quote[7]);

  if(strike===null){
    return null;
  }

  let iv:number|null=null;

  if(greekRaw && greekRaw.length>=16){
    const greek=[
      greekRaw[0],
      ...greekRaw.slice(4),
    ];

    iv=finiteNum(greek[6]);
  }

  return {
    code,
    side,
    strike,

    volume:finiteNum(quote[41]),
    openInterest:finiteNum(quote[5]),
    iv,

    bid:finiteNum(quote[1]),
    ask:finiteNum(quote[3]),
    last:finiteNum(quote[2]),
  };
}

async function loadPreviousSnapshot(
  underlying:string,
  expiry:string,
){
  const snapshots=await sql`
    select id, captured_at
    from public.option_chain_snapshots
    where underlying=${underlying}
      and expiry=${expiry}
    order by captured_at desc
    limit 1
  `;

  if(!snapshots.length){
    return {
      id:null as string|null,
      captured_at:null as unknown,
      openInterest:null as Record<string,number>|null,
    };
  }

  const previous=snapshots[0];

  const rows=await sql`
    select contract_code, open_interest
    from public.option_contract_snapshots
    where snapshot_id=${previous.id}
  `;

  return {
    id:String(previous.id),
    captured_at:previous.captured_at,
    openInterest:
      previousOpenInterestFromRows(
        rows.map((row:any)=>({
          contract_code:String(row.contract_code),
          open_interest:
            finiteNum(row.open_interest),
        })),
      ),
  };
}

async function saveSnapshot(
  snapshotId:string,
  underlying:string,
  expiry:string,
  capturedAt:string,
  contracts:OptionContract[],
){
  const rows=toContractSnapshotRows(
    snapshotId,
    underlying,
    expiry,
    contracts,
  );

  const callCount=contracts.filter(
    x=>x.side==="call",
  ).length;

  const putCount=contracts.filter(
    x=>x.side==="put",
  ).length;

  await sql.begin(async(tx:any)=>{
    await tx`
      insert into public.option_chain_snapshots (
        id,
        underlying,
        expiry,
        source,
        source_timestamp,
        captured_at,
        underlying_spot,
        contract_count,
        call_count,
        put_count
      )
      values (
        ${snapshotId},
        ${underlying},
        ${expiry},
        'sina',
        ${null},
        ${capturedAt},
        ${null},
        ${contracts.length},
        ${callCount},
        ${putCount}
      )
    `;

    const columns=[
      "snapshot_id",
      "underlying",
      "expiry",
      "contract_code",
      "side",
      "strike",
      "volume",
      "open_interest",
      "iv",
      "bid",
      "ask",
      "last",
    ];

    for(let i=0;i<rows.length;i+=100){
      const chunk=rows.slice(i,i+100);

      if(!chunk.length) continue;

      await tx`
        insert into public.option_contract_snapshots
        ${tx(chunk,...columns)}
      `;
    }
  });
}

async function optionPutPressure(a:any){
  const underlying=String(
    a?.underlying||"510050",
  );

  if(
    ![
      "510050",
      "510300",
      "588000",
      "510500",
    ].includes(underlying)
  ){
    throw new Error(
      "underlying must be 510050/510300/588000/510500",
    );
  }

  const requestedExpiry=
    a?.expiry
      ?String(a.expiry)
      :null;

  if(
    requestedExpiry &&
    !/^\d{4}$/.test(requestedExpiry)
  ){
    throw new Error(
      "expiry must be YYMM, for example 2609",
    );
  }

  const fetchedAt=
    new Date().toISOString();

  const [
    callMonths,
    putMonths,
  ]=await Promise.all([
    optionCodeMonths(
      underlying,
      "call",
    ),
    optionCodeMonths(
      underlying,
      "put",
    ),
  ]);

  const commonMonths=
    Object.keys(callMonths)
      .filter(month=>
        Array.isArray(putMonths[month]) &&
        putMonths[month].length>0
      )
      .sort();

  if(!commonMonths.length){
    throw new Error(
      "no common call/put option expiry available",
    );
  }

  const expiry=
    requestedExpiry||
    commonMonths[0];

  if(
    !callMonths[expiry] ||
    !putMonths[expiry]
  ){
    throw new Error(
      `expiry ${expiry} unavailable; available=${commonMonths.join(",")}`,
    );
  }

  const specs=[
    ...callMonths[expiry].map(
      code=>({
        code,
        side:"call" as const,
      }),
    ),
    ...putMonths[expiry].map(
      code=>({
        code,
        side:"put" as const,
      }),
    ),
  ];

  const quoteSymbols=
    specs.map(
      x=>`CON_OP_${x.code}`,
    );

  const greekSymbols=
    specs.map(
      x=>`CON_SO_${x.code}`,
    );

  const [
    quoteMap,
    greekMap,
    previous,
  ]=await Promise.all([
    listManyRaw(quoteSymbols),
    listManyRaw(greekSymbols),
    loadPreviousSnapshot(
      underlying,
      expiry,
    ),
  ]);

  const contracts:OptionContract[]=[];

  for(const spec of specs){
    const contract=
      optionContractFromRaw(
        spec.code,
        spec.side,
        quoteMap.get(
          `CON_OP_${spec.code}`,
        ),
        greekMap.get(
          `CON_SO_${spec.code}`,
        ),
      );

    if(contract){
      contracts.push(contract);
    }
  }

  if(!contracts.length){
    throw new Error(
      "Sina returned no usable option contracts",
    );
  }

  const pressure=
    computePutPressure({
      contracts,

      previousOpenInterest:
        previous.openInterest,

      underlyingSpot:null,
    });

  // Important:
  // read previous snapshot BEFORE writing current snapshot.
  const snapshotId=
    crypto.randomUUID();

  await saveSnapshot(
    snapshotId,
    underlying,
    expiry,
    fetchedAt,
    contracts,
  );

  return wrap({
    source:"sina-options",
    source_family:"sina",

    source_timestamp:null,
    fetched_at:fetchedAt,

    stale:null,

    confidence:
      Math.min(
        0.70,
        0.50+
        pressure.completeness*0.20,
      ),

    data_kind:"derived",

    underlying,
    expiry,

    contract_count:
      contracts.length,

    expected_contract_count:
      specs.length,

    dropped_contract_count:
      specs.length-contracts.length,

    snapshot:{
      current_id:snapshotId,

      previous_id:
        previous.id,

      previous_captured_at:
        previous.captured_at,

      delta_oi_available:
        previous.openInterest!==null,
    },

    pressure,

    note:
      "Sina option payload does not provide a reliably normalized source timestamp here, so stale is null rather than falsely marked fresh.",
  });
}

const TOOLS=[{name:"option_codes_sina",description:"ETF option contract codes by month. Supports 50ETF/300ETF/STAR50ETF/500ETF.",inputSchema:{type:"object",properties:{underlying:{type:"string",enum:["510050","510300","588000","510500"]},call:{type:"boolean"}},additionalProperties:false}},{name:"option_tquote_sina",description:"ETF option T-quote with bid/ask, OI, strike, volume and amount.",inputSchema:{type:"object",properties:{code:{type:"string"}},required:["code"],additionalProperties:false}},{name:"option_greeks_sina",description:"ETF option Greeks and implied volatility.",inputSchema:{type:"object",properties:{code:{type:"string"}},required:["code"],additionalProperties:false}}
,{name:"option_put_pressure",description:"Persist ETF option-chain snapshot and calculate PCR volume/OI, delta OI, IV skew, Put Wall and transparent Put Pressure risk-gate metrics. Active put buying is explicitly an estimate.",inputSchema:{type:"object",properties:{underlying:{type:"string",enum:["510050","510300","588000","510500"]},expiry:{type:"string",pattern:"^[0-9]{4}$"}},additionalProperties:false}}
];
Deno.serve(async(req)=>{if(req.method==="GET")return new Response(JSON.stringify({name:"stock-info-options",version:VERSION,status:"ok"}),{headers:{"content-type":"application/json"}});if(req.method!=="POST")return new Response("Method Not Allowed",{status:405});try{const _a=await authenticateClient(req,readSecret);logAuth("mcp-options",_a);if(!_a.ok)return je(null,-32001,"Unauthorized",undefined,401);const b=await req.json(),id=b?.id,m=b?.method,p=b?.params||{};if(m==="initialize")return jr(id,{protocolVersion:PROTOCOL,capabilities:{tools:{}},serverInfo:{name:"stock-info-options",version:VERSION}});if(m==="notifications/initialized")return new Response(null,{status:202});if(m==="ping")return jr(id,{});if(m==="tools/list")return jr(id,{tools:TOOLS});if(m==="tools/call"){const n=String(p?.name||""),a=p?.arguments||{};if(n==="option_codes_sina")return jr(id,await codes(a));if(n==="option_tquote_sina")return jr(id,await tq(a));if(n==="option_greeks_sina")return jr(id,await gr(a));if(n==="option_put_pressure")return jr(id,await optionPutPressure(a));return je(id,-32601,`unknown tool ${n}`)}return je(id,-32601,`Method not found: ${m}`)}catch(e){return je(null,-32603,"Internal error",e instanceof Error?e.message:String(e),500)}});