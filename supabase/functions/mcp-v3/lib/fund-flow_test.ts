import {
  assert,
  assertAlmostEquals,
  assertEquals,
} from "jsr:@std/assert@1";

import {
  computeFundFlowConsensus,
  type FlowObservation,
} from "./fund-flow.ts";

Deno.test("independent source families vote independently", () => {
  const observations: FlowObservation[] = [
    {
      source: "tencent-tail",
      sourceFamily: "tencent",
      kind: "price_volume",
      signal: 0.6,
      confidence: 0.8,
      stale: false,
      dataKind: "estimate",
    },
    {
      source: "itick-depth",
      sourceFamily: "itick",
      kind: "orderbook",
      signal: 0.4,
      confidence: 0.9,
      stale: false,
      dataKind: "derived",
    },
  ];

  const r =
    computeFundFlowConsensus(
      observations,
    );

  assertEquals(
    r.independent_sources,
    2,
  );

  assert(
    r.signal_1_to_1! > 0,
  );

  assertEquals(
    r.direction,
    "inflow",
  );
});

Deno.test("duplicate wrappers from same source family do not double vote", () => {
  const observations: FlowObservation[] = [
    {
      source: "wrapper-a",
      sourceFamily: "eastmoney",
      kind: "net_flow",
      signal: 1,
      confidence: 0.9,
      stale: false,
      dataKind: "raw",
    },
    {
      source: "wrapper-b",
      sourceFamily: "eastmoney",
      kind: "net_flow",
      signal: -1,
      confidence: 0.2,
      stale: false,
      dataKind: "raw",
    },
    {
      source: "itick",
      sourceFamily: "itick",
      kind: "orderbook",
      signal: 0,
      confidence: 0.9,
      stale: false,
      dataKind: "derived",
    },
  ];

  const r =
    computeFundFlowConsensus(
      observations,
    );

  assertEquals(
    r.independent_sources,
    2,
  );

  assertEquals(
    r.used_observations.length,
    2,
  );

  assertEquals(
    r.used_observations[0]
      .source,
    "wrapper-a",
  );
});

Deno.test("stale and estimated observations receive lower effective weight", () => {
  const r =
    computeFundFlowConsensus([
      {
        source: "fresh-raw",
        sourceFamily: "a",
        kind: "net_flow",
        signal: 0.5,
        confidence: 1,
        stale: false,
        dataKind: "raw",
      },
      {
        source: "stale-estimate",
        sourceFamily: "b",
        kind: "price_volume",
        signal: -1,
        confidence: 1,
        stale: true,
        dataKind: "estimate",
      },
    ]);

  assert(
    r.signal_1_to_1! > 0,
  );

  const stale =
    r.used_observations.find(
      x =>
        x.source ===
        "stale-estimate",
    );

  assert(
    stale!.effective_weight <
      0.5,
  );
});

Deno.test("opposing providers expose disagreement instead of averaging it away silently", () => {
  const r =
    computeFundFlowConsensus([
      {
        source: "a",
        sourceFamily: "a",
        kind: "net_flow",
        signal: 0.9,
        confidence: 1,
        stale: false,
        dataKind: "raw",
      },
      {
        source: "b",
        sourceFamily: "b",
        kind: "orderbook",
        signal: -0.9,
        confidence: 1,
        stale: false,
        dataKind: "raw",
      },
    ]);

  assertEquals(
    r.conflict,
    true,
  );

  assertAlmostEquals(
    r.signal_1_to_1!,
    0,
    1e-9,
  );

  assert(
    r.confidence < 0.5,
  );
});

Deno.test("no usable flow observations produces unavailable rather than neutral fabrication", () => {
  const r =
    computeFundFlowConsensus([]);

  assertEquals(
    r.signal_1_to_1,
    null,
  );

  assertEquals(
    r.direction,
    "unavailable",
  );

  assertEquals(
    r.confidence,
    0,
  );
});
