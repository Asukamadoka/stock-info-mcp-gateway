import {
  assertAlmostEquals,
  assertEquals,
} from "jsr:@std/assert@1";

import {
  computeBarVwap,
  computeIntradaySignals,
  computeRelativeStrength,
  computeTailSession,
  type IntradayBar,
} from "./market-signals.ts";

Deno.test("bar VWAP uses typical price weighted by volume", () => {
  const bars: IntradayBar[] = [
    {
      time: "202609020930",
      open: 9,
      high: 11,
      low: 9,
      close: 10,
      volume: 100,
    },
    {
      time: "202609020935",
      open: 11,
      high: 13,
      low: 11,
      close: 12,
      volume: 300,
    },
  ];

  const r = computeBarVwap(bars);

  // typical prices are 10 and 12
  assertAlmostEquals(r.value!, 11.5, 1e-9);
  assertEquals(r.method, "typical_price_x_volume");
  assertEquals(r.data_kind, "estimate");
});

Deno.test("15m and 30m relative strength compare matched windows", () => {
  const target: IntradayBar[] = [
    { time:"202609020930", open:10, high:10, low:10, close:10.2, volume:100 },
    { time:"202609020935", open:10.2, high:10.4, low:10.1, close:10.4, volume:100 },
    { time:"202609020940", open:10.4, high:11, low:10.3, close:11, volume:100 },
    { time:"202609020945", open:11, high:11.2, low:10.9, close:11.2, volume:100 },
    { time:"202609020950", open:11.2, high:11.5, low:11.1, close:11.5, volume:100 },
    { time:"202609020955", open:11.5, high:12, low:11.4, close:12, volume:100 },
  ];

  const benchmark: IntradayBar[] = [
    { time:"202609020930", open:10, high:10, low:10, close:10.1, volume:100 },
    { time:"202609020935", open:10.1, high:10.2, low:10, close:10.2, volume:100 },
    { time:"202609020940", open:10.2, high:10.5, low:10.1, close:10.5, volume:100 },
    { time:"202609020945", open:10.5, high:10.6, low:10.4, close:10.6, volume:100 },
    { time:"202609020950", open:10.6, high:10.8, low:10.5, close:10.8, volume:100 },
    { time:"202609020955", open:10.8, high:11, low:10.7, close:11, volume:100 },
  ];

  const r15 = computeRelativeStrength(target, benchmark, 3);
  const r30 = computeRelativeStrength(target, benchmark, 6);

  assertAlmostEquals(
    r15!.relative_return_pct_points,
    ((12 / 11 - 1) - (11 / 10.5 - 1)) * 100,
    1e-9,
  );

  assertAlmostEquals(
    r30!.relative_return_pct_points,
    10,
    1e-9,
  );
});

Deno.test("tail session computes both 14:00 and 14:30 windows", () => {
  const bars: IntradayBar[] = [
    { time:"202609021400", open:10, high:10.2, low:9.9, close:10.1, volume:100 },
    { time:"202609021405", open:10.1, high:10.3, low:10, close:10.2, volume:100 },
    { time:"202609021410", open:10.2, high:10.4, low:10.1, close:10.3, volume:100 },
    { time:"202609021415", open:10.3, high:10.5, low:10.2, close:10.4, volume:100 },
    { time:"202609021420", open:10.4, high:10.6, low:10.3, close:10.5, volume:100 },
    { time:"202609021425", open:10.5, high:10.7, low:10.4, close:10.6, volume:100 },

    { time:"202609021430", open:10.6, high:10.8, low:10.5, close:10.7, volume:200 },
    { time:"202609021435", open:10.7, high:10.9, low:10.6, close:10.8, volume:200 },
    { time:"202609021440", open:10.8, high:11, low:10.7, close:10.9, volume:200 },
    { time:"202609021445", open:10.9, high:11.1, low:10.8, close:11, volume:200 },
    { time:"202609021450", open:11, high:11.2, low:10.9, close:11.1, volume:200 },
    { time:"202609021455", open:11.1, high:11.3, low:11, close:11.2, volume:200 },
  ];

  const r = computeTailSession(bars);

  assertAlmostEquals(
    r.since_1400!.return_pct,
    12,
    1e-9,
  );

  assertAlmostEquals(
    r.since_1430!.return_pct,
    (11.2 / 10.6 - 1) * 100,
    1e-9,
  );

  assertEquals(r.since_1430!.volume, 1200);

  assertAlmostEquals(
    r.volume_share_since_1430!,
    1200 / 1800,
    1e-9,
  );
});

Deno.test("intraday signals expose VWAP state, RS and tail snapshots", () => {
  const target: IntradayBar[] = [
    { time:"202609021400", open:10, high:10.2, low:9.9, close:10.1, volume:100 },
    { time:"202609021405", open:10.1, high:10.3, low:10, close:10.2, volume:100 },
    { time:"202609021410", open:10.2, high:10.4, low:10.1, close:10.3, volume:100 },
    { time:"202609021415", open:10.3, high:10.5, low:10.2, close:10.4, volume:100 },
    { time:"202609021420", open:10.4, high:10.6, low:10.3, close:10.5, volume:100 },
    { time:"202609021425", open:10.5, high:10.7, low:10.4, close:10.6, volume:100 },
    { time:"202609021430", open:10.6, high:10.8, low:10.5, close:10.7, volume:200 },
    { time:"202609021435", open:10.7, high:10.9, low:10.6, close:10.8, volume:200 },
    { time:"202609021440", open:10.8, high:11, low:10.7, close:10.9, volume:200 },
    { time:"202609021445", open:10.9, high:11.1, low:10.8, close:11, volume:200 },
    { time:"202609021450", open:11, high:11.2, low:10.9, close:11.1, volume:200 },
    { time:"202609021455", open:11.1, high:11.3, low:11, close:11.2, volume:200 },
  ];

  const benchmark = target.map((x) => ({
    ...x,
    open: x.open * 0.99,
    high: x.high * 0.99,
    low: x.low * 0.99,
    close: x.close * 0.995,
  }));

  const r = computeIntradaySignals(
    target,
    benchmark,
  );

  assertEquals(r.data_kind, "derived");
  assertEquals(r.vwap.data_kind, "estimate");
  assertEquals(r.vwap_state, "above");
  assertEquals(r.rs_15m !== null, true);
  assertEquals(r.rs_30m !== null, true);
  assertEquals(r.tail.since_1400 !== null, true);
  assertEquals(r.tail.since_1430 !== null, true);
  assertEquals(r.completeness, 1);
});
