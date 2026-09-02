import { callQmtMcpTool, QmtMcpError } from "./qmt-mcp-client.ts";
export { QmtMcpError } from "./qmt-mcp-client.ts";

export type QmtGatewayConfig={url:string;token?:string};
export type QmtGatewayDeps={loadConfig:()=>Promise<QmtGatewayConfig|null>;callTool?:(config:QmtGatewayConfig,name:string,args:Record<string,unknown>)=>Promise<unknown>};

type GatewayName="qmt_status"|"qmt_quote"|"qmt_option_chain";

function unavailable(error:string,errorType="unavailable"){return {source:"qmt-mcp",source_family:"qmt",source_timestamp:null,fetched_at:new Date().toISOString(),stale:null,confidence:0,data_kind:"raw",status:errorType==="not_authorized"?"permission":errorType==="unsupported"||errorType==="capability"?"unsupported":"unavailable",data:null,error,error_type:errorType};}

function fixedCall(name:GatewayName,args:Record<string,unknown>):{name:string;args:Record<string,unknown>}{
  if(name==="qmt_status") return {name:"qmt_capabilities",args:{}};
  if(name==="qmt_quote"){const out:Record<string,unknown>={codes:args.codes};if(args.fields!==undefined)out.fields=args.fields;if(args.cache_policy!==undefined)out.cache_policy=args.cache_policy;return {name:"qmt_xtdata_snapshot",args:out};}
  const out:Record<string,unknown>={underlying:args.underlying};if(args.trade_date!==undefined)out.trade_date=args.trade_date;return {name:"qmt_xtdata_option_chain",args:out};
}

export async function runQmtGatewayTool(name:GatewayName,args:Record<string,unknown>,deps:QmtGatewayDeps){
  const config=await deps.loadConfig(); if(!config?.url?.trim()) return unavailable("QMT bridge is not configured","config");
  const call=deps.callTool??((c,n,a)=>callQmtMcpTool({baseUrl:c.url,token:c.token},n,a)); const mapped=fixedCall(name,args);
  try{const data=await call(config,mapped.name,mapped.args);return {source:"qmt-mcp",source_family:"qmt",source_timestamp:null,fetched_at:new Date().toISOString(),stale:null,confidence:0.65,data_kind:"raw",status:"ok",data,error:null,error_type:null};}
  catch(e){if(e instanceof QmtMcpError)return unavailable(e.message,e.kind);return unavailable(e instanceof Error?e.message:String(e),"dependency");}
}
