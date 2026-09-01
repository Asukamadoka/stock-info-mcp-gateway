import {
  assert,
  assertEquals,
} from "jsr:@std/assert@1";

import {
  buildFlowObservations,
  technicalScoreFromIntraday,
} from "./decision-adapters.ts";

const strongSignals:any = {
  vwap:{
    value:10,
    method:"typical_price_x_volume",
    data_kind:"estimate",
    note:"",
  },

  last_price:10.2,
  vwap_distance_pct:1,

  vwap_state:"above",

  rs_15m:{
    bars:3,
    target_return_pct:2,
    benchmark_return_pct:0.5,
    relative_return_pct_points:1.5,
    relative_return_bps:150,
    data_kind:"derived",
  },

  rs_30m:{
    bars:6,
    target_return_pct:3,
    benchmark_return_pct:0.5,
    relative_return_pct_points:2.5,
    relative_return_bps:250,
    data_kind:"derived",
  },

  tail:{
    since_1400:null,

    since_1430:{
      anchor:"14:30",
      first_time:"202609021430",
      last_time:"202609021455",
      open:10,
      close:10.2,
      high:10.3,
      low:9.9,
      volume:1000,
      return_pct:2,
      close_location_0_1:0.75,

      vwap:{
        value:10.1,
        method:"typical_price_x_volume",
        data_kind:"estimate",
        note:"",
      },
    },

    volume_share_since_1430:0.6,
    data_kind:"derived",
  },

  completeness:1,
  data_kind:"derived",
  notes:[],
};

Deno.test("strong intraday signals produce technical score above neutral", () => {
  const r =
    technicalScoreFromIntraday(
      strongSignals,
    );

  assert(r.score !== null);
  assert(r.score! > 50);

  assertEquals(
    r.critical1430Available,
    true,
  );

  assertEquals(
    r.completeness,
    1,
  );
});

Deno.test("missing 14:30 tail is explicitly incomplete", () => {
  const signals = {
    ...strongSignals,

    tail:{
      ...strongSignals.tail,
      since_1430:null,
    },
  };

  const r =
    technicalScoreFromIntraday(
      signals,
    );

  assertEquals(
    r.critical1430Available,
    false,
  );

  assert(
    r.completeness < 1,
  );
});

Deno.test("flow observations combine Tencent price-volume proxy and usable iTick depth", () => {
  const observations =
    buildFlowObservations({
      signals:strongSignals,

      tencent:{
        confidence:0.9,
        stale:false,
      },

      l2:{
        source:"itick-depth",
        source_family:"itick",

        source_timestamp:null,
        fetched_at:
          "2026-09-02T07:30:00+08:00",

        stale:null,
        confidence:0.7,

        data_kind:"raw",
        status:"ok",

        error:null,

        data:{
          provider:"itick",
          source_family:"itick",
          code:"600519",
          market:"SH",
          source_timestamp:null,
          endpoint_class:"production",

          book:{
            code:"600519",
            market:"SH",
            bids:[],
            asks:[],
          },

          metrics:{
            bid_volume:100,
            ask_volume:50,

            bid_orders:2,
            ask_orders:1,

            orderbook_imbalance:
              1/3,

            top_level_imbalance:
              0.5,

            spread:0.01,
            spread_bps:10,

            mid_price:10,
            microprice:10.01,

            data_kind:"derived",
            notes:[],
          },
        },
      },
    });

  assertEquals(
    observations.length,
    2,
  );

  assertEquals(
    observations[0]
      .sourceFamily,
    "tencent",
  );

  assertEquals(
    observations[0]
      .dataKind,
    "estimate",
  );

  assertEquals(
    observations[1]
      .sourceFamily,
    "itick",
  );

  assert(
    observations[1]
      .signal! > 0,
  );
});

Deno.test("unavailable Level-2 is omitted rather than replaced by fake depth", () => {
  const observations =
    buildFlowObservations({
      signals:strongSignals,

      tencent:{
        confidence:0.9,
        stale:false,
      },

      l2:{
        source:"itick-depth",
        source_family:"itick",

        source_timestamp:null,
        fetched_at:
          "2026-09-02T07:30:00+08:00",

        stale:null,
        confidence:0,

        data_kind:"raw",
        status:"unavailable",

        data:null,
        error:
          "iTick token unavailable",
      },
    });

  assertEquals(
    observations.length,
    1,
  );

  assertEquals(
    observations[0]
      .sourceFamily,
    "tencent",
  );
});
