import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertRejects,
} from "jsr:@std/assert@1";

import {
  computeOrderBookMetrics,
  fetchItickDepth,
  normalizeItickDepth,
} from "./level2.ts";

const raw = {
  s: "600519",
  a: [
    { po: 2, p: 10.2, v: 150, o: 2 },
    { po: 1, p: 10.1, v: 50, o: 1 },
  ],
  b: [
    { po: 2, p: 9.9, v: 300, o: 4 },
    { po: 1, p: 10.0, v: 100, o: 2 },
  ],
};

Deno.test("normalizes iTick depth in level order", () => {
  const book = normalizeItickDepth(
    raw,
    "600519",
    "SH",
  );

  assertEquals(book.code, "600519");
  assertEquals(book.market, "SH");

  assertEquals(book.asks[0], {
    level: 1,
    price: 10.1,
    volume: 50,
    orders: 1,
  });

  assertEquals(book.bids[0], {
    level: 1,
    price: 10,
    volume: 100,
    orders: 2,
  });
});

Deno.test("computes transparent order-book imbalance metrics", () => {
  const book = normalizeItickDepth(
    raw,
    "600519",
    "SH",
  );

  const m = computeOrderBookMetrics(book);

  assertEquals(m.bid_volume, 400);
  assertEquals(m.ask_volume, 200);

  assertAlmostEquals(
    m.orderbook_imbalance!,
    1 / 3,
    1e-9,
  );

  assertAlmostEquals(
    m.top_level_imbalance!,
    1 / 3,
    1e-9,
  );

  assertAlmostEquals(
    m.spread_bps!,
    ((10.1 - 10) / 10.05) * 10000,
    1e-9,
  );

  assertAlmostEquals(
    m.microprice!,
    (10.1 * 100 + 10 * 50) / 150,
    1e-9,
  );

  assertEquals(m.data_kind, "derived");
});

Deno.test("empty book does not fabricate signals", () => {
  const m = computeOrderBookMetrics({
    code: "600519",
    market: "SH",
    bids: [],
    asks: [],
  });

  assertEquals(m.orderbook_imbalance, null);
  assertEquals(m.top_level_imbalance, null);
  assertEquals(m.spread_bps, null);
  assertEquals(m.microprice, null);
});

Deno.test("fetchItickDepth accepts documented REST depth payload", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        code: 0,
        msg: null,
        data: raw,
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );

  const r = await fetchItickDepth({
    token: "test-token",
    code: "600519",
    region: "SH",
    baseUrls: ["https://example.invalid"],
    fetchImpl: fakeFetch,
  });

  assertEquals(r.provider, "itick");
  assertEquals(r.source_timestamp, null);

  assertEquals(
    r.book.bids[0].price,
    10,
  );

  assert(
    r.metrics.orderbook_imbalance !== null,
  );
});

Deno.test("iTick auth failure is classified as permission", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        code: "E002",
        msg: "auth failed",
        data: null,
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );

  await assertRejects(
    () =>
      fetchItickDepth({
        token: "expired-token",
        code: "600519",
        region: "SH",
        baseUrls: ["https://example.invalid"],
        fetchImpl: fakeFetch,
      }),
    Error,
    "permission:",
  );
});

Deno.test("iTick subscription limit is classified as quota", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        code: "E003",
        msg: "exceeding the maximum subscription limit",
        data: null,
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );

  await assertRejects(
    () =>
      fetchItickDepth({
        token: "test-token",
        code: "600519",
        region: "SH",
        baseUrls: ["https://example.invalid"],
        fetchImpl: fakeFetch,
      }),
    Error,
    "quota:",
  );
});
