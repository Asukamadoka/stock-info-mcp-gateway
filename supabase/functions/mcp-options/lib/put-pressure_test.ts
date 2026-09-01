import {
  assert,
  assertAlmostEquals,
  assertEquals,
} from "jsr:@std/assert@1";

import {
  computePutPressure,
  type OptionContract,
} from "./put-pressure.ts";

const contracts: OptionContract[] = [
  {
    code: "C100",
    side: "call",
    strike: 100,
    volume: 100,
    openInterest: 200,
    iv: 0.20,
    bid: 1.0,
    ask: 1.2,
    last: 1.1,
  },
  {
    code: "C105",
    side: "call",
    strike: 105,
    volume: 50,
    openInterest: 100,
    iv: 0.22,
    bid: 0.5,
    ask: 0.7,
    last: 0.6,
  },
  {
    code: "P100",
    side: "put",
    strike: 100,
    volume: 150,
    openInterest: 300,
    iv: 0.25,
    bid: 1.3,
    ask: 1.5,
    last: 1.5,
  },
  {
    code: "P95",
    side: "put",
    strike: 95,
    volume: 50,
    openInterest: 100,
    iv: 0.24,
    bid: 0.7,
    ask: 0.9,
    last: 0.8,
  },
];

const previous = {
  C100: 190,
  C105: 110,
  P100: 250,
  P95: 90,
};

Deno.test("computes PCR volume and OI", () => {
  const r = computePutPressure({
    contracts,
    previousOpenInterest: previous,
    underlyingSpot: 101,
  });

  assertAlmostEquals(r.pcr_volume!, 200 / 150, 1e-9);
  assertAlmostEquals(r.pcr_oi!, 400 / 300, 1e-9);
});

Deno.test("computes put OI delta only from matched previous contracts", () => {
  const r = computePutPressure({
    contracts,
    previousOpenInterest: previous,
    underlyingSpot: 101,
  });

  assertEquals(r.put_oi_delta, 60);
  assertEquals(r.call_oi_delta, 0);
  assertAlmostEquals(r.put_oi_delta_ratio!, 60 / 340, 1e-9);
});

Deno.test("computes matched-strike IV skew", () => {
  const r = computePutPressure({
    contracts,
    previousOpenInterest: previous,
    underlyingSpot: 101,
  });

  // Strike 100 has both call and put IV:
  // 0.25 - 0.20 = 0.05
  assertAlmostEquals(r.iv_skew!, 0.05, 1e-9);
});

Deno.test("normalizes IV expressed as percentage", () => {
  const x: OptionContract[] = [
    {
      code: "C100",
      side: "call",
      strike: 100,
      volume: 1,
      openInterest: 10,
      iv: 20,
    },
    {
      code: "P100",
      side: "put",
      strike: 100,
      volume: 1,
      openInterest: 10,
      iv: 25,
    },
  ];

  const r = computePutPressure({ contracts: x });

  assertAlmostEquals(r.iv_skew!, 0.05, 1e-9);
});

Deno.test("finds Put Wall from highest put open interest", () => {
  const r = computePutPressure({
    contracts,
    previousOpenInterest: previous,
    underlyingSpot: 101,
  });

  assertEquals(r.put_wall?.strike, 100);
  assertEquals(r.put_wall?.open_interest, 300);
  assertAlmostEquals(r.put_wall!.share_of_put_oi, 0.75, 1e-9);
  assertAlmostEquals(
    r.put_wall!.distance_pct!,
    Math.abs(100 - 101) / 101,
    1e-9,
  );
});

Deno.test("active put buying is explicitly an estimate", () => {
  const r = computePutPressure({
    contracts,
    previousOpenInterest: previous,
    underlyingSpot: 101,
  });

  assertEquals(
    r.active_put_buying_estimate?.data_kind,
    "estimate",
  );

  assert(
    r.active_put_buying_estimate!.score_0_1 > 0.8,
  );

  assert(
    r.active_put_buying_estimate!.basis.includes("positive put OI delta"),
  );
});

Deno.test("without previous snapshot delta OI is unavailable rather than fabricated", () => {
  const r = computePutPressure({
    contracts,
    underlyingSpot: 101,
  });

  assertEquals(r.put_oi_delta, null);
  assertEquals(r.call_oi_delta, null);
  assertEquals(r.put_oi_delta_ratio, null);
  assertEquals(r.active_put_buying_estimate, null);

  assert(r.completeness < 1);
});

Deno.test("returns bounded transparent pressure score", () => {
  const r = computePutPressure({
    contracts,
    previousOpenInterest: previous,
    underlyingSpot: 101,
  });

  assert(r.pressure_score >= 0);
  assert(r.pressure_score <= 100);
  assert(r.completeness > 0.9);

  assertEquals(r.model_version, "put-pressure-heuristic-v1");
  assertEquals(r.data_kind, "derived");

  assert(Array.isArray(r.components));
  assert(r.components.length === 6);
});
