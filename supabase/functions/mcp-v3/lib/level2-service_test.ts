import {
  assertEquals,
} from "jsr:@std/assert@1";

import {
  getLevel2OrderBook,
} from "./level2-service.ts";

const depth = {
  provider: "itick" as const,
  source_family: "itick" as const,

  code: "600519",
  market: "SH" as const,

  source_timestamp: null,

  endpoint_class: "production" as const,

  book: {
    code: "600519",
    market: "SH" as const,
    bids: [
      {
        level: 1,
        price: 10,
        volume: 100,
        orders: 2,
      },
    ],
    asks: [
      {
        level: 1,
        price: 10.1,
        volume: 50,
        orders: 1,
      },
    ],
  },

  metrics: {
    bid_volume: 100,
    ask_volume: 50,

    bid_orders: 2,
    ask_orders: 1,

    orderbook_imbalance: 1 / 3,
    top_level_imbalance: 1 / 3,

    spread: 0.1,
    spread_bps: 99.502487562,

    mid_price: 10.05,
    microprice: 10.0666666667,

    data_kind: "derived" as const,

    notes: [],
  },
};

Deno.test("Level-2 success is explicit about unknown source freshness", async () => {
  const r = await getLevel2OrderBook({
    code: "600519",
    market: "SH",

    tokenLoader: async () =>
      "test-token",

    depthFetcher: async () =>
      depth,

    now: () =>
      new Date(
        "2026-09-02T02:00:00+08:00",
      ),
  });

  assertEquals(r.status, "ok");
  assertEquals(r.source, "itick-depth");

  assertEquals(
    r.source_timestamp,
    null,
  );

  assertEquals(r.stale, null);
  assertEquals(r.confidence, 0.7);

  assertEquals(
    r.data?.metrics
      .orderbook_imbalance,
    1 / 3,
  );
});

Deno.test("missing iTick token returns unavailable rather than throwing", async () => {
  const r = await getLevel2OrderBook({
    code: "600519",
    market: "SH",

    tokenLoader: async () => {
      throw new Error(
        "missing secret",
      );
    },

    depthFetcher: async () =>
      depth,
  });

  assertEquals(
    r.status,
    "unavailable",
  );

  assertEquals(r.data, null);

  assertEquals(
    r.error,
    "iTick token unavailable",
  );
});

Deno.test("expired or rejected iTick credential returns permission", async () => {
  const r = await getLevel2OrderBook({
    code: "600519",
    market: "SH",

    tokenLoader: async () =>
      "test-token",

    depthFetcher: async () => {
      throw new Error(
        "permission: iTick E002 auth failed",
      );
    },
  });

  assertEquals(
    r.status,
    "permission",
  );

  assertEquals(r.data, null);
});

Deno.test("iTick subscription limit returns quota", async () => {
  const r = await getLevel2OrderBook({
    code: "600519",
    market: "SH",

    tokenLoader: async () =>
      "test-token",

    depthFetcher: async () => {
      throw new Error(
        "quota: iTick E003 subscription limit",
      );
    },
  });

  assertEquals(
    r.status,
    "quota",
  );

  assertEquals(r.data, null);
});
