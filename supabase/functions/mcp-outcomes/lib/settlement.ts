// Pure settlement logic. No I/O, no provider calls — every function here is
// directly testable and every honesty rule lives in one place.

export type Stance = "bullish" | "neutral" | "bearish";

export type UnfillableReason =
  | "limit_up_at_open"
  | "limit_down_at_open"
  | "halted"
  | "no_data"
  | null;

export type SettlementStatus = "settled" | "unmeasurable";

export interface Bar {
  open: number | null;
  close: number | null;
  prevClose: number | null;
  halted?: boolean;
}

export interface Settlement {
  status: SettlementStatus;
  unmeasurable_reason: string | null;
  fillable: boolean;
  unfillable_reason: UnfillableReason;
  entry_price: number | null;
  exit_price: number | null;
  return_pct: number | null;
}

export function roundTo(n: number, dp = 6): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * A-share execution reality. A signal you could not act on is not a win.
 *
 * limitPct is supplied by the caller rather than inferred from the code:
 * main board 0.10, ST 0.05, STAR/ChiNext 0.20, BJ 0.30. Guessing the board
 * from a ticker is error-prone, and a wrong guess silently corrupts every
 * downstream statistic.
 */
export function assessFillability(
  bar: Bar,
  stance: Stance,
  limitPct: number,
): { fillable: boolean; reason: UnfillableReason } {
  if (bar.halted) return { fillable: false, reason: "halted" };
  if (bar.open === null || bar.prevClose === null || bar.prevClose <= 0) {
    return { fillable: false, reason: "no_data" };
  }
  const eps = 1e-9;
  const upper = bar.prevClose * (1 + limitPct);
  const lower = bar.prevClose * (1 - limitPct);
  if (stance === "bullish" && bar.open >= upper - eps) {
    return { fillable: false, reason: "limit_up_at_open" };
  }
  if (stance === "bearish" && bar.open <= lower + eps) {
    return { fillable: false, reason: "limit_down_at_open" };
  }
  return { fillable: true, reason: null };
}

export function computeReturn(
  entry: number | null,
  exit: number | null,
  stance: Stance,
): number | null {
  if (entry === null || exit === null || entry <= 0) return null;
  const raw = (exit - entry) / entry;
  // A bearish call is judged on the move going against price.
  return roundTo(stance === "bearish" ? -raw : raw);
}

export function settle(args: {
  bar: Bar;
  stance: Stance;
  limitPct: number;
}): Settlement {
  const fill = assessFillability(args.bar, args.stance, args.limitPct);
  if (!fill.fillable) {
    return {
      status: "unmeasurable",
      unmeasurable_reason: fill.reason,
      fillable: false,
      unfillable_reason: fill.reason,
      entry_price: args.bar.open,
      exit_price: args.bar.close,
      return_pct: null,
    };
  }
  const r = computeReturn(args.bar.open, args.bar.close, args.stance);
  if (r === null) {
    return {
      status: "unmeasurable",
      unmeasurable_reason: "no_data",
      fillable: true,
      unfillable_reason: null,
      entry_price: args.bar.open,
      exit_price: args.bar.close,
      return_pct: null,
    };
  }
  return {
    status: "settled",
    unmeasurable_reason: null,
    fillable: true,
    unfillable_reason: null,
    entry_price: args.bar.open,
    exit_price: args.bar.close,
    return_pct: r,
  };
}

/** Look-ahead guard: realized data must post-date the decision's cutoff. */
export function violatesLookahead(
  handoffCutoffIso: string | null,
  marketTimestampIso: string | null,
): boolean {
  if (!handoffCutoffIso || !marketTimestampIso) return false;
  const cutoff = Date.parse(handoffCutoffIso);
  const market = Date.parse(marketTimestampIso);
  if (Number.isNaN(cutoff) || Number.isNaN(market)) return false;
  return market <= cutoff;
}

/**
 * Below this many settled outcomes the scorecard reports no statistics at all.
 * A hit rate over six samples is noise wearing a number's clothes, and a
 * number is far more persuasive than it deserves to be.
 */
export const MIN_SAMPLE = 30;

function ranks(values: number[]): number[] {
  const idx = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k].i] = avg;
    i = j + 1;
  }
  return out;
}

export function rankIc(
  rows: { return_pct: number | null; predicted_score: number | null }[],
): number | null {
  const pairs = rows.filter(
    (r) => r.return_pct !== null && r.predicted_score !== null,
  ) as { return_pct: number; predicted_score: number }[];
  if (pairs.length < 3) return null;
  const rx = ranks(pairs.map((p) => p.predicted_score));
  const ry = ranks(pairs.map((p) => p.return_pct));
  const n = pairs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i] - mx, b = ry[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return roundTo(num / Math.sqrt(dx * dy), 4);
}

export interface Scorecard {
  status: "ok" | "insufficient_sample";
  n: number;
  min_sample: number;
  message: string;
  hit_rate: number | null;
  mean_return: number | null;
  rank_ic: number | null;
}

export function scorecard(
  rows: {
    status: string;
    return_pct: number | null;
    predicted_score: number | null;
  }[],
  minSample: number = MIN_SAMPLE,
): Scorecard {
  const settled = rows.filter(
    (r) => r.status === "settled" && r.return_pct !== null,
  );
  const n = settled.length;
  if (n < minSample) {
    return {
      status: "insufficient_sample",
      n,
      min_sample: minSample,
      message:
        `need at least ${minSample} settled outcomes before any statistic is reported; have ${n}`,
      hit_rate: null,
      mean_return: null,
      rank_ic: null,
    };
  }
  const hits = settled.filter((r) => (r.return_pct as number) > 0).length;
  const mean = settled.reduce((a, r) => a + (r.return_pct as number), 0) / n;
  return {
    status: "ok",
    n,
    min_sample: minSample,
    message: "",
    hit_rate: roundTo(hits / n, 4),
    mean_return: roundTo(mean, 6),
    rank_ic: rankIc(settled),
  };
}
