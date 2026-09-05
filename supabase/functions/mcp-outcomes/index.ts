import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
import { authenticateClient, logAuth } from "../_shared/auth.ts";
import {
  MIN_SAMPLE,
  scorecard,
  settle,
  type Stance,
  violatesLookahead,
} from "./lib/settlement.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const VERSION = "1.0.0";
const PROTOCOL = "2025-11-25";
const secretCache = new Map<string, { v: string; t: number }>();

async function secret(name: string) {
  const c = secretCache.get(name);
  if (c && Date.now() - c.t < 300000) return c.v;
  const r = await sql`select decrypted_secret from vault.decrypted_secrets where name=${name} limit 1`;
  const v = String(r?.[0]?.decrypted_secret || "");
  if (!v) throw new Error(`missing secret ${name}`);
  secretCache.set(name, { v, t: Date.now() });
  return v;
}
async function auth(req: Request) {
  const r = await authenticateClient(req, secret);
  logAuth("mcp-outcomes", r);
  return r.ok;
}
function jres(id: unknown, result: unknown, status = 200) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status, headers: { "content-type": "application/json; charset=utf-8" },
  });
}
function jerr(id: unknown, code: number, message: string, status = 200) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }), {
    status, headers: { "content-type": "application/json; charset=utf-8" },
  });
}
function wrap(data: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: { data, status: 200, message: "" } };
}
function validDate(s: string) { return /^\d{4}-\d{2}-\d{2}$/.test(s); }
function validStage(s: string) { return ["premarket", "midday", "tail"].includes(s); }
function validStance(s: string): s is Stance { return ["bullish", "neutral", "bearish"].includes(s); }
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function outcomeRecord(a: any) {
  const tradingDate = String(a?.trading_date || "");
  const stage = String(a?.stage || "");
  const subject = String(a?.subject || "").trim();
  const stance = String(a?.stance || "");
  if (!validDate(tradingDate)) throw new Error("trading_date must be YYYY-MM-DD");
  if (!validStage(stage)) throw new Error("stage must be premarket|midday|tail");
  if (!subject) throw new Error("subject required");
  if (!validStance(stance)) throw new Error("stance must be bullish|neutral|bearish");

  const limitPct = num(a?.limit_pct);
  if (limitPct === null || limitPct <= 0 || limitPct > 0.5) {
    throw new Error("limit_pct required (0.10 main board, 0.05 ST, 0.20 STAR/ChiNext, 0.30 BJ)");
  }

  const handoff = await sql`
    select generated_at, source_cutoff from public.decision_handoffs
    where trading_date=${tradingDate}::date and stage=${stage} limit 1`;
  if (!handoff.length) throw new Error(`no handoff for ${tradingDate}/${stage}; nothing to settle`);
  const cutoff = handoff[0].source_cutoff ? new Date(handoff[0].source_cutoff).toISOString() : null;

  const marketTs = a?.market_source_timestamp ? String(a.market_source_timestamp) : null;
  if (violatesLookahead(cutoff, marketTs)) {
    throw new Error("look-ahead: market_source_timestamp is not after the handoff source_cutoff");
  }

  const s = settle({
    bar: {
      open: num(a?.open), close: num(a?.close),
      prevClose: num(a?.prev_close), halted: a?.halted === true,
    },
    stance, limitPct,
  });

  const prior = await sql`
    select coalesce(max(revision),0) as r from public.decision_outcomes
    where trading_date=${tradingDate}::date and stage=${stage} and subject=${subject}`;
  const revision = Number(prior[0].r) + 1;

  const rows = await sql`
    insert into public.decision_outcomes (
      trading_date, stage, subject, revision,
      handoff_generated_at, handoff_source_cutoff,
      predicted_stance, predicted_score, predicted_confidence,
      settle_date, entry_price, exit_price, return_pct, horizon_days,
      settlement_status, unmeasurable_reason, fillable, unfillable_reason,
      market_source, market_source_timestamp, data_kind
    ) values (
      ${tradingDate}::date, ${stage}, ${subject}, ${revision},
      ${handoff[0].generated_at}, ${handoff[0].source_cutoff},
      ${stance}, ${num(a?.predicted_score)}, ${num(a?.predicted_confidence)},
      ${a?.settle_date && validDate(String(a.settle_date)) ? String(a.settle_date) : null}::date,
      ${s.entry_price}, ${s.exit_price}, ${s.return_pct},
      ${a?.horizon_days === undefined ? 1 : Number(a.horizon_days)},
      ${s.status}, ${s.unmeasurable_reason}, ${s.fillable}, ${s.unfillable_reason},
      ${a?.market_source ? String(a.market_source) : null}, ${marketTs}::timestamptz, 'derived'
    )
    returning trading_date::text, stage, subject, revision, settlement_status,
              return_pct, fillable, unfillable_reason, computed_at`;

  return wrap({
    status: "ok", source: "stock-info-mcp-gateway", source_family: "internal",
    source_timestamp: marketTs, stale: false,
    confidence: s.status === "settled" ? 1 : 0,
    data_kind: "derived", record: rows[0] ?? null,
  });
}

async function outcomeGet(a: any) {
  const tradingDate = String(a?.trading_date || "");
  if (!validDate(tradingDate)) throw new Error("trading_date must be YYYY-MM-DD");
  const rows = await sql`
    select distinct on (stage, subject)
      trading_date::text, stage, subject, revision, predicted_stance,
      predicted_score, settlement_status, unmeasurable_reason, fillable,
      unfillable_reason, entry_price, exit_price, return_pct, horizon_days,
      market_source, market_source_timestamp, computed_at
    from public.decision_outcomes
    where trading_date=${tradingDate}::date
    order by stage, subject, revision desc`;
  return wrap({
    status: rows.length ? "ok" : "not_found", source: "stock-info-mcp-gateway",
    source_family: "internal", source_timestamp: null, stale: false,
    confidence: rows.length ? 1 : 0, data_kind: "derived", records: rows,
  });
}

async function outcomeScorecard(a: any) {
  const from = String(a?.from || "");
  const to = String(a?.to || "");
  if (!validDate(from) || !validDate(to)) throw new Error("from and to must be YYYY-MM-DD");
  const stage = a?.stage ? String(a.stage) : null;
  if (stage && !validStage(stage)) throw new Error("stage must be premarket|midday|tail");

  const rows = await sql`
    select distinct on (trading_date, stage, subject)
      settlement_status as status, return_pct, predicted_score
    from public.decision_outcomes
    where trading_date between ${from}::date and ${to}::date
      and (${stage}::text is null or stage = ${stage})
    order by trading_date, stage, subject, revision desc`;

  const card = scorecard(
    rows.map((r: any) => ({
      status: String(r.status),
      return_pct: r.return_pct === null ? null : Number(r.return_pct),
      predicted_score: r.predicted_score === null ? null : Number(r.predicted_score),
    })),
  );

  return wrap({
    status: "ok", source: "stock-info-mcp-gateway", source_family: "internal",
    source_timestamp: null, stale: false,
    confidence: card.status === "ok" ? 1 : 0,
    data_kind: "derived",
    window: { from, to, stage: stage ?? "all" },
    scorecard: card,
  });
}

const TOOLS = [
  {
    name: "outcome_record",
    description:
      "Settle one stored decision handoff against a realized session. Supply the realized bar; the caller owns market-data retrieval. Refuses to settle when the market timestamp does not post-date the handoff cutoff. Limit-up at open on a bullish call, limit-down on a bearish call, a halt, or missing data all record as unmeasurable rather than as a return. Never overwrites: re-settlement appends a new revision.",
    inputSchema: {
      type: "object",
      properties: {
        trading_date: { type: "string" }, stage: { type: "string", enum: ["premarket", "midday", "tail"] },
        subject: { type: "string" }, stance: { type: "string", enum: ["bullish", "neutral", "bearish"] },
        limit_pct: { type: "number" }, open: { type: "number" }, close: { type: "number" },
        prev_close: { type: "number" }, halted: { type: "boolean" },
        predicted_score: { type: "number" }, predicted_confidence: { type: "number" },
        settle_date: { type: "string" }, horizon_days: { type: "number" },
        market_source: { type: "string" }, market_source_timestamp: { type: "string" },
      },
      required: ["trading_date", "stage", "subject", "stance", "limit_pct"],
      additionalProperties: false,
    },
  },
  {
    name: "outcome_get",
    description: "Read the latest settlement revision for every subject on one trading date.",
    inputSchema: {
      type: "object", properties: { trading_date: { type: "string" } },
      required: ["trading_date"], additionalProperties: false,
    },
  },
  {
    name: "outcome_scorecard",
    description:
      `Rolling hit rate, mean return and rank IC over a date window. Reports no statistic at all below ${MIN_SAMPLE} settled outcomes — a hit rate over a handful of samples is noise wearing a number's clothes.`,
    inputSchema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" }, stage: { type: "string" } },
      required: ["from", "to"], additionalProperties: false,
    },
  },
];

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ name: "stock-info-mcp-outcomes", version: VERSION, status: "ready", source_of_truth: "github" }),
      { headers: { "content-type": "application/json" } },
    );
  }
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  try {
    if (!(await auth(req))) return jerr(null, -32001, "Unauthorized", 401);
    const b = await req.json(), id = b?.id, m = b?.method, p = b?.params || {};
    if (m === "initialize") {
      return jres(id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "stock-info-mcp-outcomes", version: VERSION } });
    }
    if (m === "notifications/initialized") return new Response(null, { status: 202 });
    if (m === "ping") return jres(id, {});
    if (m === "tools/list") return jres(id, { tools: TOOLS });
    if (m === "tools/call") {
      const n = String(p?.name || ""), a = p?.arguments || {};
      if (n === "outcome_record") return jres(id, await outcomeRecord(a));
      if (n === "outcome_get") return jres(id, await outcomeGet(a));
      if (n === "outcome_scorecard") return jres(id, await outcomeScorecard(a));
      return jerr(id, -32601, "Unknown outcome tool");
    }
    return jerr(id, -32601, "Method not found");
  } catch (e) {
    return jerr(null, -32000, e instanceof Error ? e.message : String(e));
  }
});
