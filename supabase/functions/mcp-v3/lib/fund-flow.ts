export type FlowDataKind =
  | "raw"
  | "derived"
  | "estimate";

export type FlowKind =
  | "net_flow"
  | "orderbook"
  | "price_volume"
  | "chip";

export type FlowObservation = {
  source: string;
  sourceFamily: string;

  kind: FlowKind;

  // -1 = strongest outflow
  // +1 = strongest inflow
  signal: number | null;

  confidence: number;

  stale: boolean | null;

  dataKind: FlowDataKind;
};

export type UsedFlowObservation =
  FlowObservation & {
    effective_weight: number;
  };

export type FundFlowConsensus = {
  signal_1_to_1: number | null;

  score_0_to_100: number | null;

  direction:
    | "strong_outflow"
    | "outflow"
    | "neutral"
    | "inflow"
    | "strong_inflow"
    | "unavailable";

  confidence: number;

  independent_sources: number;

  conflict: boolean;

  used_observations:
    UsedFlowObservation[];

  excluded_observations: {
    source: string;
    reason: string;
  }[];

  data_kind: "derived";

  notes: string[];
};

function clamp(
  n: number,
  min: number,
  max: number,
): number {
  return Math.max(
    min,
    Math.min(max, n),
  );
}

function dataKindFactor(
  kind: FlowDataKind,
): number {
  if (kind === "raw") {
    return 1;
  }

  if (kind === "derived") {
    return 0.9;
  }

  return 0.8;
}

function staleFactor(
  stale: boolean | null,
): number {
  if (stale === true) {
    return 0.4;
  }

  if (stale === null) {
    return 0.7;
  }

  return 1;
}

function effectiveWeight(
  x: FlowObservation,
): number {
  return clamp(
    x.confidence,
    0,
    1,
  ) *
    dataKindFactor(
      x.dataKind,
    ) *
    staleFactor(
      x.stale,
    );
}

function direction(
  signal: number | null,
): FundFlowConsensus[
  "direction"
] {
  if (signal === null) {
    return "unavailable";
  }

  if (signal <= -0.6) {
    return "strong_outflow";
  }

  if (signal <= -0.2) {
    return "outflow";
  }

  if (signal < 0.2) {
    return "neutral";
  }

  if (signal < 0.6) {
    return "inflow";
  }

  return "strong_inflow";
}

export function computeFundFlowConsensus(
  input: FlowObservation[],
): FundFlowConsensus {
  const excluded:
    FundFlowConsensus[
      "excluded_observations"
    ] = [];

  const valid =
    input.filter((x) => {
      if (
        x.signal === null ||
        !Number.isFinite(
          x.signal,
        )
      ) {
        excluded.push({
          source: x.source,
          reason:
            "missing signal",
        });

        return false;
      }

      return true;
    });

  // One independent vote per true
  // upstream/source family.
  // If wrappers point to the same
  // underlying domain, keep only
  // the highest-quality observation.
  const byFamily =
    new Map<
      string,
      UsedFlowObservation
    >();

  for (const item of valid) {
    const normalized = {
      ...item,

      signal:
        clamp(
          item.signal!,
          -1,
          1,
        ),

      effective_weight:
        effectiveWeight(item),
    };

    const existing =
      byFamily.get(
        item.sourceFamily,
      );

    if (
      !existing ||
      normalized
        .effective_weight >
        existing
          .effective_weight
    ) {
      if (existing) {
        excluded.push({
          source:
            existing.source,
          reason:
            "duplicate source family",
        });
      }

      byFamily.set(
        item.sourceFamily,
        normalized,
      );
    } else {
      excluded.push({
        source: item.source,
        reason:
          "duplicate source family",
      });
    }
  }

  const used =
    [...byFamily.values()];

  if (!used.length) {
    return {
      signal_1_to_1: null,
      score_0_to_100: null,

      direction:
        "unavailable",

      confidence: 0,

      independent_sources: 0,

      conflict: false,

      used_observations: [],

      excluded_observations:
        excluded,

      data_kind: "derived",

      notes: [
        "no usable flow observation; neutral flow is not fabricated",
      ],
    };
  }

  const weight =
    used.reduce(
      (sum, x) =>
        sum +
        x.effective_weight,
      0,
    );

  const weightedSignal =
    weight > 0
      ? used.reduce(
        (sum, x) =>
          sum +
          x.signal! *
          x.effective_weight,
        0,
      ) / weight
      : null;

  const hasPositive =
    used.some(
      x => x.signal! > 0.2,
    );

  const hasNegative =
    used.some(
      x => x.signal! < -0.2,
    );

  const conflict =
    hasPositive &&
    hasNegative;

  // Source count raises confidence,
  // but disagreement penalizes it.
  const sourceCoverage =
    clamp(
      used.length / 3,
      0,
      1,
    );

  const averageWeight =
    weight /
    used.length;

  let confidence =
    clamp(
      averageWeight *
      (
        0.55 +
        sourceCoverage * 0.45
      ),
      0,
      1,
    );

  if (conflict) {
    confidence *= 0.45;
  }

  const signal =
    weightedSignal === null
      ? null
      : clamp(
        weightedSignal,
        -1,
        1,
      );

  return {
    signal_1_to_1:
      signal,

    score_0_to_100:
      signal === null
        ? null
        : (
          signal + 1
        ) * 50,

    direction:
      direction(signal),

    confidence:
      Math.round(
        confidence * 1000,
      ) / 1000,

    independent_sources:
      used.length,

    conflict,

    used_observations:
      used,

    excluded_observations:
      excluded,

    data_kind: "derived",

    notes: [
      "independent upstream domains count as independent votes; wrappers over the same source do not",
      "order-book and price-volume signals are proxies, not official institutional net-flow data",
      "conflicting source directions reduce confidence rather than being hidden by a simple average",
    ],
  };
}
