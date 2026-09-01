import type {
  IntradaySignals,
} from "./market-signals.ts";

import type {
  Level2ServiceResult,
} from "./level2-service.ts";

import type {
  FlowObservation,
} from "./fund-flow.ts";

export type TechnicalScoreResult = {
  score:number|null;

  completeness:number;

  critical1430Available:boolean;

  components:{
    name:
      | "vwap"
      | "rs15"
      | "rs30"
      | "tail1430";

    weight:number;

    score:number|null;
  }[];

  model_version:
    "intraday-technical-v1";

  notes:string[];
};

function clamp(
  value:number,
  min:number,
  max:number,
){
  return Math.max(
    min,
    Math.min(max,value),
  );
}

function centeredScore(
  value:number|null,
  scale:number,
):number|null{
  if(
    value===null ||
    !Number.isFinite(value)
  ){
    return null;
  }

  return clamp(
    50+
    clamp(
      value/scale,
      -1,
      1,
    )*50,
    0,
    100,
  );
}

export function technicalScoreFromIntraday(
  signals:IntradaySignals,
):TechnicalScoreResult{
  const components:
    TechnicalScoreResult[
      "components"
    ]=[
      {
        name:"vwap",
        weight:30,
        score:
          centeredScore(
            signals
              .vwap_distance_pct,
            1.5,
          ),
      },

      {
        name:"rs15",
        weight:25,
        score:
          centeredScore(
            signals.rs_15m
              ?.relative_return_pct_points
              ?? null,
            1.5,
          ),
      },

      {
        name:"rs30",
        weight:25,
        score:
          centeredScore(
            signals.rs_30m
              ?.relative_return_pct_points
              ?? null,
            2.5,
          ),
      },

      {
        name:"tail1430",
        weight:20,
        score:
          centeredScore(
            signals.tail
              .since_1430
              ?.return_pct
              ?? null,
            2,
          ),
      },
    ];

  const available =
    components.filter(
      x=>x.score!==null,
    );

  const availableWeight =
    available.reduce(
      (sum,x)=>
        sum+x.weight,
      0,
    );

  const score =
    availableWeight>0
      ?available.reduce(
        (sum,x)=>
          sum+
          x.score!*
          x.weight,
        0,
      )/
      availableWeight
      :null;

  return {
    score:
      score===null
        ?null
        :Math.round(
          score*100,
        )/100,

    completeness:
      availableWeight/100,

    critical1430Available:
      signals.tail
        .since_1430!==null &&
      signals.rs_15m!==null &&
      signals.rs_30m!==null,

    components,

    model_version:
      "intraday-technical-v1",

    notes:[
      "technical score is a transparent heuristic derived from VWAP distance, 15m RS, 30m RS and 14:30 tail return",
      "mapping scales are ±1.5% VWAP distance, ±1.5pp RS15, ±2.5pp RS30 and ±2% tail return",
      "missing components reduce completeness; they are not fabricated",
    ],
  };
}

function normalizedProxy(
  value:number|null,
  scale:number,
):number|null{
  if(
    value===null ||
    !Number.isFinite(value)
  ){
    return null;
  }

  return clamp(
    value/scale,
    -1,
    1,
  );
}

function average(
  values:(number|null)[],
):number|null{
  const usable =
    values.filter(
      (x):x is number=>
        x!==null &&
        Number.isFinite(x),
    );

  if(!usable.length){
    return null;
  }

  return usable.reduce(
    (a,b)=>a+b,
    0,
  )/usable.length;
}

export function buildFlowObservations(
  args:{
    signals:IntradaySignals;

    tencent:{
      confidence:number;
      stale:boolean|null;
    };

    l2?:
      Level2ServiceResult|
      null;
  },
):FlowObservation[]{
  const out:
    FlowObservation[]=[];

  const closeLocation =
    args.signals.tail
      .since_1430
      ?.close_location_0_1;

  const tencentSignal =
    average([
      normalizedProxy(
        args.signals
          .vwap_distance_pct,
        1.5,
      ),

      normalizedProxy(
        args.signals.rs_15m
          ?.relative_return_pct_points
          ?? null,
        1.5,
      ),

      normalizedProxy(
        args.signals.rs_30m
          ?.relative_return_pct_points
          ?? null,
        2.5,
      ),

      normalizedProxy(
        args.signals.tail
          .since_1430
          ?.return_pct
          ?? null,
        2,
      ),

      closeLocation===null ||
      closeLocation===undefined
        ?null
        :clamp(
          closeLocation*2-1,
          -1,
          1,
        ),
    ]);

  if(tencentSignal!==null){
    out.push({
      source:
        "tencent-tail-proxy",

      sourceFamily:
        "tencent",

      kind:
        "price_volume",

      signal:
        tencentSignal,

      confidence:
        clamp(
          args.tencent
            .confidence,
          0,
          1,
        ),

      stale:
        args.tencent.stale,

      dataKind:
        "estimate",
    });
  }

  if(
    args.l2?.status==="ok" &&
    args.l2.data
  ){
    const metrics =
      args.l2.data.metrics;

    const l2Signal =
      average([
        metrics
          .orderbook_imbalance,

        metrics
          .top_level_imbalance,
      ]);

    if(l2Signal!==null){
      out.push({
        source:
          "itick-depth",

        sourceFamily:
          "itick",

        kind:
          "orderbook",

        signal:
          l2Signal,

        confidence:
          args.l2.confidence,

        stale:
          args.l2.stale,

        dataKind:
          "derived",
      });
    }
  }

  return out;
}
