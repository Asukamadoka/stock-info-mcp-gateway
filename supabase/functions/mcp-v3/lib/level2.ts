export type L2Market = "SH" | "SZ";

export type L2Level = {
  level: number;
  price: number;
  volume: number;
  orders: number | null;
};

export type L2OrderBook = {
  code: string;
  market: L2Market;

  bids: L2Level[];
  asks: L2Level[];
};

export type OrderBookMetrics = {
  bid_volume: number;
  ask_volume: number;

  bid_orders: number | null;
  ask_orders: number | null;

  orderbook_imbalance: number | null;
  top_level_imbalance: number | null;

  spread: number | null;
  spread_bps: number | null;

  mid_price: number | null;
  microprice: number | null;

  data_kind: "derived";

  notes: string[];
};

type ItickLevel = {
  po?: unknown;
  p?: unknown;
  v?: unknown;
  o?: unknown;
};

type ItickDepthData = {
  s?: unknown;
  a?: ItickLevel[];
  b?: ItickLevel[];
};

type ItickResponse = {
  code?: unknown;
  msg?: unknown;
  data?: ItickDepthData | null;
};

export type ItickDepthResult = {
  provider: "itick";
  source_family: "itick";

  code: string;
  market: L2Market;

  source_timestamp: null;

  book: L2OrderBook;
  metrics: OrderBookMetrics;

  endpoint_class:
    | "free"
    | "production"
    | "custom";
};

function n(
  value: unknown,
): number | null {
  const x = Number(value);

  return Number.isFinite(x)
    ? x
    : null;
}

function normalizeLevel(
  x: ItickLevel,
): L2Level | null {
  const level = n(x.po);
  const price = n(x.p);
  const volume = n(x.v);
  const orders = n(x.o);

  if (
    level === null ||
    price === null ||
    volume === null
  ) {
    return null;
  }

  return {
    level,
    price,
    volume,
    orders,
  };
}

function levels(
  input: ItickLevel[] | undefined,
): L2Level[] {
  return (input ?? [])
    .map(normalizeLevel)
    .filter(
      (x): x is L2Level =>
        x !== null,
    )
    .sort(
      (a, b) =>
        a.level - b.level,
    );
}

export function normalizeItickDepth(
  data: ItickDepthData,
  code: string,
  market: L2Market,
): L2OrderBook {
  return {
    code,
    market,

    bids: levels(data.b),
    asks: levels(data.a),
  };
}

function imbalance(
  bid: number,
  ask: number,
): number | null {
  const total = bid + ask;

  if (total <= 0) return null;

  return (bid - ask) / total;
}

export function computeOrderBookMetrics(
  book: L2OrderBook,
): OrderBookMetrics {
  const bidVolume =
    book.bids.reduce(
      (sum, x) =>
        sum + Math.max(0, x.volume),
      0,
    );

  const askVolume =
    book.asks.reduce(
      (sum, x) =>
        sum + Math.max(0, x.volume),
      0,
    );

  const bidOrderValues =
    book.bids
      .map(x => x.orders)
      .filter(
        (x): x is number =>
          x !== null,
      );

  const askOrderValues =
    book.asks
      .map(x => x.orders)
      .filter(
        (x): x is number =>
          x !== null,
      );

  const bidOrders =
    bidOrderValues.length
      ? bidOrderValues.reduce(
        (a, b) => a + b,
        0,
      )
      : null;

  const askOrders =
    askOrderValues.length
      ? askOrderValues.reduce(
        (a, b) => a + b,
        0,
      )
      : null;

  const bestBid =
    book.bids[0] ?? null;

  const bestAsk =
    book.asks[0] ?? null;

  const midPrice =
    bestBid && bestAsk
      ? (
        bestBid.price +
        bestAsk.price
      ) / 2
      : null;

  const spread =
    bestBid && bestAsk
      ? bestAsk.price -
        bestBid.price
      : null;

  const spreadBps =
    spread !== null &&
      midPrice !== null &&
      midPrice > 0
      ? (
        spread /
        midPrice
      ) * 10000
      : null;

  const topLevelImbalance =
    bestBid && bestAsk
      ? imbalance(
        bestBid.volume,
        bestAsk.volume,
      )
      : null;

  let microprice: number | null =
    null;

  if (
    bestBid &&
    bestAsk &&
    bestBid.volume +
      bestAsk.volume >
      0
  ) {
    microprice =
      (
        bestAsk.price *
          bestBid.volume +
        bestBid.price *
          bestAsk.volume
      ) /
      (
        bestBid.volume +
        bestAsk.volume
      );
  }

  return {
    bid_volume: bidVolume,
    ask_volume: askVolume,

    bid_orders: bidOrders,
    ask_orders: askOrders,

    orderbook_imbalance:
      imbalance(
        bidVolume,
        askVolume,
      ),

    top_level_imbalance:
      topLevelImbalance,

    spread,
    spread_bps: spreadBps,

    mid_price: midPrice,
    microprice,

    data_kind: "derived",

    notes: [
      "orderbook imbalance is derived from visible bid/ask depth only",
      "this snapshot alone cannot prove cancellations, hidden orders, or active trade direction",
    ],
  };
}

function endpointClass(
  base: string,
): ItickDepthResult["endpoint_class"] {
  if (
    base.includes(
      "api-free.itick.org",
    )
  ) {
    return "free";
  }

  if (
    base.includes(
      "api.itick.org",
    )
  ) {
    return "production";
  }

  return "custom";
}

function apiError(
  payload: ItickResponse,
): Error {
  const code =
    String(
      payload.code ?? "",
    );

  const msg =
    String(
      payload.msg ?? "",
    );

  const text =
    `${code} ${msg}`.trim();

  if (
    code === "E002" ||
    /auth failed/i.test(text)
  ) {
    return new Error(
      `permission: iTick ${text}`,
    );
  }

  if (
    code === "E003" ||
    /maximum subscription|quota|rate limit/i
      .test(text)
  ) {
    return new Error(
      `quota: iTick ${text}`,
    );
  }

  return new Error(
    `iTick API error: ${text}`,
  );
}

export async function fetchItickDepth(
  args: {
    token: string;
    code: string;
    region: L2Market;

    baseUrls?: string[];

    fetchImpl?: typeof fetch;
  },
): Promise<ItickDepthResult> {
  if (
    !/^\d{6}$/.test(args.code)
  ) {
    throw new Error(
      "code must be six digits",
    );
  }

  const fetchImpl =
    args.fetchImpl ?? fetch;

  const bases =
    args.baseUrls ?? [
      "https://api-free.itick.org",
      "https://api.itick.org",
    ];

  let lastError:
    Error | null = null;

  for (const base of bases) {
    try {
      const url =
        new URL(
          "/stock/depth",
          base,
        );

      url.searchParams.set(
        "region",
        args.region,
      );

      url.searchParams.set(
        "code",
        args.code,
      );

      const response =
        await fetchImpl(
          url.toString(),
          {
            headers: {
              accept:
                "application/json",

              token:
                args.token,
            },
          },
        );

      if (!response.ok) {
        if (
          response.status === 401 ||
          response.status === 403
        ) {
          throw new Error(
            `permission: iTick HTTP ${response.status}`,
          );
        }

        if (
          response.status === 429
        ) {
          throw new Error(
            "quota: iTick HTTP 429",
          );
        }

        throw new Error(
          `iTick HTTP ${response.status}`,
        );
      }

      const payload = (
        await response.json()
      ) as ItickResponse;

      if (
        Number(payload.code) !== 0
      ) {
        throw apiError(payload);
      }

      if (!payload.data) {
        throw new Error(
          "iTick depth data missing",
        );
      }

      const book =
        normalizeItickDepth(
          payload.data,
          args.code,
          args.region,
        );

      return {
        provider: "itick",
        source_family: "itick",

        code: args.code,
        market: args.region,

        // Documented REST depth
        // response has no source
        // timestamp.
        source_timestamp: null,

        book,

        metrics:
          computeOrderBookMetrics(
            book,
          ),

        endpoint_class:
          endpointClass(base),
      };
    } catch (error) {
      lastError =
        error instanceof Error
          ? error
          : new Error(
            String(error),
          );
    }
  }

  throw (
    lastError ??
    new Error(
      "iTick depth unavailable",
    )
  );
}
