import { assert, assertEquals } from "jsr:@std/assert";
import {
  assessFillability,
  computeReturn,
  MIN_SAMPLE,
  rankIc,
  scorecard,
  settle,
  violatesLookahead,
} from "./settlement.ts";

Deno.test("limit-up at open makes a bullish signal unmeasurable, not a win", () => {
  const r = settle({
    bar: { open: 11, close: 11, prevClose: 10, halted: false },
    stance: "bullish",
    limitPct: 0.1,
  });
  assertEquals(r.status, "unmeasurable");
  assertEquals(r.unfillable_reason, "limit_up_at_open");
  assertEquals(r.return_pct, null);
});

Deno.test("limit-down at open blocks a bearish exit", () => {
  const r = settle({
    bar: { open: 9, close: 9, prevClose: 10 },
    stance: "bearish",
    limitPct: 0.1,
  });
  assertEquals(r.status, "unmeasurable");
  assertEquals(r.unfillable_reason, "limit_down_at_open");
});

Deno.test("limit-up does not block a bearish call", () => {
  const f = assessFillability(
    { open: 11, close: 11, prevClose: 10 },
    "bearish",
    0.1,
  );
  assertEquals(f.fillable, true);
});

Deno.test("a halted session is unmeasurable", () => {
  const r = settle({
    bar: { open: null, close: null, prevClose: 10, halted: true },
    stance: "bullish",
    limitPct: 0.1,
  });
  assertEquals(r.status, "unmeasurable");
  assertEquals(r.unfillable_reason, "halted");
});

Deno.test("missing data never becomes a zero return", () => {
  const r = settle({
    bar: { open: 10, close: null, prevClose: 9.5 },
    stance: "bullish",
    limitPct: 0.1,
  });
  assertEquals(r.status, "unmeasurable");
  assertEquals(r.unmeasurable_reason, "no_data");
  assertEquals(r.return_pct, null);
});

Deno.test("a normal bullish session settles to a signed return", () => {
  const r = settle({
    bar: { open: 10, close: 10.5, prevClose: 9.8 },
    stance: "bullish",
    limitPct: 0.1,
  });
  assertEquals(r.status, "settled");
  assertEquals(r.fillable, true);
  assertEquals(r.return_pct, 0.05);
});

Deno.test("a bearish call is scored on the downside", () => {
  assertEquals(computeReturn(10, 9, "bearish"), 0.1);
  assertEquals(computeReturn(10, 11, "bearish"), -0.1);
});

Deno.test("market data at or before the decision cutoff is look-ahead", () => {
  assertEquals(
    violatesLookahead("2026-09-04T06:00:00Z", "2026-09-04T06:00:00Z"),
    true,
  );
  assertEquals(
    violatesLookahead("2026-09-04T06:00:00Z", "2026-09-04T05:59:00Z"),
    true,
  );
  assertEquals(
    violatesLookahead("2026-09-04T06:00:00Z", "2026-09-05T01:30:00Z"),
    false,
  );
});

Deno.test("the scorecard reports nothing below the minimum sample", () => {
  const rows = Array.from({ length: MIN_SAMPLE - 1 }, () => ({
    status: "settled",
    return_pct: 0.01,
    predicted_score: 80,
  }));
  const s = scorecard(rows);
  assertEquals(s.status, "insufficient_sample");
  assertEquals(s.hit_rate, null);
  assertEquals(s.mean_return, null);
  assertEquals(s.rank_ic, null);
  assert(s.message.includes(String(MIN_SAMPLE)));
});

Deno.test("unmeasurable rows never count toward the sample", () => {
  const rows = [
    ...Array.from({ length: 40 }, () => ({
      status: "unmeasurable",
      return_pct: null,
      predicted_score: 90,
    })),
    ...Array.from({ length: 5 }, () => ({
      status: "settled",
      return_pct: 0.02,
      predicted_score: 70,
    })),
  ];
  const s = scorecard(rows);
  assertEquals(s.status, "insufficient_sample");
  assertEquals(s.n, 5);
});

Deno.test("the scorecard reports statistics once the sample is large enough", () => {
  const rows = Array.from({ length: MIN_SAMPLE }, (_, i) => ({
    status: "settled",
    return_pct: i % 2 === 0 ? 0.02 : -0.01,
    predicted_score: i,
  }));
  const s = scorecard(rows);
  assertEquals(s.status, "ok");
  assertEquals(s.n, MIN_SAMPLE);
  assert(s.hit_rate !== null && s.hit_rate > 0 && s.hit_rate < 1);
  assert(s.mean_return !== null);
});

Deno.test("rank IC is +1 for a perfectly ordered forecast", () => {
  const rows = [
    { return_pct: 0.01, predicted_score: 1 },
    { return_pct: 0.02, predicted_score: 2 },
    { return_pct: 0.03, predicted_score: 3 },
    { return_pct: 0.04, predicted_score: 4 },
  ];
  assertEquals(rankIc(rows), 1);
});

Deno.test("rank IC is -1 when the forecast is exactly inverted", () => {
  const rows = [
    { return_pct: 0.04, predicted_score: 1 },
    { return_pct: 0.03, predicted_score: 2 },
    { return_pct: 0.02, predicted_score: 3 },
    { return_pct: 0.01, predicted_score: 4 },
  ];
  assertEquals(rankIc(rows), -1);
});

Deno.test("rank IC is null when a score carries no variation", () => {
  const rows = [
    { return_pct: 0.01, predicted_score: 5 },
    { return_pct: 0.02, predicted_score: 5 },
    { return_pct: 0.03, predicted_score: 5 },
  ];
  assertEquals(rankIc(rows), null);
});
