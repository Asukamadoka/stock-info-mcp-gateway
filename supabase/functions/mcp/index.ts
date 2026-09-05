import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const CORE="https://aneonwkxfhgqywtczmvc.supabase.co/functions/v1/mcp-v3";
const OPTIONS="https://aneonwkxfhgqywtczmvc.supabase.co/functions/v1/mcp-options";
const HTSC="https://aneonwkxfhgqywtczmvc.supabase.co/functions/v1/mcp-htsc";
const HANDOFF="https://aneonwkxfhgqywtczmvc.supabase.co/functions/v1/mcp-handoff";
const OUTCOMES="https://aneonwkxfhgqywtczmvc.supabase.co/functions/v1/mcp-outcomes";
async function f(url:string,req:Request,body?:ArrayBuffer){const h=new Headers(req.headers);h.delete("host");h.delete("content-length");const init:RequestInit={method:req.method,headers:h,redirect:"manual"};if(body!==undefined&&req.method!=="GET"&&req.method!=="HEAD")init.body=body;return await fetch(url,init)}
// tools/list must degrade, not fail. A single unhealthy module used to reject
// the whole Promise.all and take the entire tool list down with it.
async function toolsOf(url:string,req:Request,body:ArrayBuffer):Promise<any[]>{
 try{const r=await f(url,req,body);if(!r.ok)return [];const j=await r.json();return j?.result?.tools||[]}catch{return []}
}
Deno.serve(async(req:Request)=>{
 if(req.method==="GET"){const r=await f(CORE,req);const h=new Headers(r.headers);h.set("x-stock-info-router","core-v3+options+htsc+handoff+outcomes");return new Response(r.body,{status:r.status,headers:h})}
 if(req.method!=="POST"){const r=await f(CORE,req);return new Response(r.body,{status:r.status,headers:r.headers})}
 const body=await req.arrayBuffer();let p:any=null;try{p=JSON.parse(new TextDecoder().decode(body))}catch{}
 const mk=()=>new Request(req.url,{method:"POST",headers:req.headers});
 if(p?.method==="tools/list"){
  const lists=await Promise.all([CORE,OPTIONS,HTSC,HANDOFF,OUTCOMES].map(u=>toolsOf(u,mk(),body)));
  return new Response(JSON.stringify({jsonrpc:"2.0",id:p?.id,result:{tools:lists.flat()}}),{status:200,headers:{"content-type":"application/json; charset=utf-8","x-stock-info-router":"merged-tools"}})
 }
 const n=String(p?.params?.name||"");let target=CORE,label="core-v3";
 if(p?.method==="tools/call"&&n.startsWith("option_")){target=OPTIONS;label="options"}
 else if(p?.method==="tools/call"&&n.startsWith("ht_")){target=HTSC;label="htsc"}
 else if(p?.method==="tools/call"&&n.startsWith("handoff_")){target=HANDOFF;label="handoff"}
 else if(p?.method==="tools/call"&&n.startsWith("outcome_")){target=OUTCOMES;label="outcomes"}
 const r=await f(target,mk(),body);const h=new Headers(r.headers);h.set("x-stock-info-router",label);return new Response(r.body,{status:r.status,headers:h});
});
