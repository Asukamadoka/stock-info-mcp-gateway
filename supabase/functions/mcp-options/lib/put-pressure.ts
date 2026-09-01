export type OptionSide = "call" | "put";

export type OptionContract = {
  code: string;
  side: OptionSide;

  strike: number;

  volume: number | null;
  openInterest: number | null;
  iv: number | null;

  bid?: number | null;
  ask?: number | null;
  last?: number | null;
};

export type PutPressureInput = {
  contracts: OptionContract[];

  previousOpenInterest?: Record<string, number> | null;

  underlyingSpot?: number | null;
};

type PutWall = {
  code: string;
  strike: number;
  open_interest: number;
  share_of_put_oi: number;
  distance_pct: number | null;
};

type ActivePutBuyingEstimate = {
  score_0_1: number;
  data_kind: "estimate";
  basis: string;
};

type ScoreComponent = {
  name:
    | "pcr_volume"
    | "pcr_oi"
    | "put_oi_delta"
    | "iv_skew"
    | "put_wall"
    | "active_put_buying";

  weight: number;
  available: boolean;
  signal_0_1: number | null;
  weighted_points: number;
};

export type PutPressureResult = {
  pcr_volume: number | null;
  pcr_oi: number | null;

  put_oi_delta: number | null;
  call_oi_delta: number | null;
  put_oi_delta_ratio: number | null;

  iv_skew: number | null;

  put_wall: PutWall | null;

  active_put_buying_estimate:
    | ActivePutBuyingEstimate
    | null;

  pressure_score: number;
  pressure_level:
    | "low"
    | "neutral"
    | "elevated"
    | "high"
    | "extreme";

  completeness: number;

  components: ScoreComponent[];

  data_kind: "derived";
  model_version: "put-pressure-heuristic-v1";

  notes: string[];
};

function finite(
  value: number | null | undefined,
): value is number {
  return typeof value === "number" &&
    Number.isFinite(value);
}

function clamp(
  value: number,
  min = 0,
  max = 1,
): number {
  return Math.max(min, Math.min(max, value));
}

function scale(
  value: number,
  low: number,
  high: number,
): number {
  if (high <= low) return 0;

  return clamp(
    (value - low) / (high - low),
  );
}

function ratio(
  numerator: number,
  denominator: number,
): number | null {
  if (!Number.isFinite(numerator)) return null;
  if (!Number.isFinite(denominator)) return null;
  if (denominator <= 0) return null;

  return numerator / denominator;
}

function normalizeIv(
  value: number | null | undefined,
): number | null {
  if (!finite(value)) return null;
  if (value < 0) return null;

  // Sina/other providers may expose IV either as:
  // 0.25 or 25.
  return value > 3
    ? value / 100
    : value;
}

function sumField(
  contracts: OptionContract[],
  field: "volume" | "openInterest",
): number {
  return contracts.reduce(
    (sum, contract) => {
      const value = contract[field];

      return finite(value)
        ? sum + Math.max(0, value)
        : sum;
    },
    0,
  );
}

function matchedOiDelta(
  contracts: OptionContract[],
  previous: Record<string, number> | null | undefined,
): {
  delta: number | null;
  previousTotal: number | null;
  matched: number;
} {
  if (!previous) {
    return {
      delta: null,
      previousTotal: null,
      matched: 0,
    };
  }

  let delta = 0;
  let previousTotal = 0;
  let matched = 0;

  for (const contract of contracts) {
    if (!finite(contract.openInterest)) continue;

    const old = previous[contract.code];

    if (!finite(old)) continue;

    delta += contract.openInterest - old;
    previousTotal += old;
    matched += 1;
  }

  if (matched === 0) {
    return {
      delta: null,
      previousTotal: null,
      matched: 0,
    };
  }

  return {
    delta,
    previousTotal,
    matched,
  };
}

function computeIvSkew(
  calls: OptionContract[],
  puts: OptionContract[],
): number | null {
  const callsByStrike = new Map<
    number,
    OptionContract
  >();

  for (const call of calls) {
    const iv = normalizeIv(call.iv);

    if (iv === null) continue;

    callsByStrike.set(call.strike, call);
  }

  let weightedDiff = 0;
  let totalWeight = 0;

  for (const put of puts) {
    const call = callsByStrike.get(
      put.strike,
    );

    if (!call) continue;

    const putIv = normalizeIv(put.iv);
    const callIv = normalizeIv(call.iv);

    if (
      putIv === null ||
      callIv === null
    ) {
      continue;
    }

    const callOi = finite(call.openInterest)
      ? Math.max(0, call.openInterest)
      : 0;

    const putOi = finite(put.openInterest)
      ? Math.max(0, put.openInterest)
      : 0;

    const weight =
      Math.min(callOi, putOi) || 1;

    weightedDiff +=
      (putIv - callIv) * weight;

    totalWeight += weight;
  }

  return totalWeight > 0
    ? weightedDiff / totalWeight
    : null;
}

function computePutWall(
  puts: OptionContract[],
  totalPutOi: number,
  spot?: number | null,
): PutWall | null {
  const usable = puts.filter(
    (contract) =>
      finite(contract.openInterest) &&
      contract.openInterest > 0,
  );

  if (usable.length === 0) return null;

  const wall = usable.reduce(
    (best, current) =>
      current.openInterest! >
          best.openInterest!
        ? current
        : best,
  );

  const share =
    totalPutOi > 0
      ? wall.openInterest! / totalPutOi
      : 0;

  const distance =
    finite(spot) && spot > 0
      ? Math.abs(wall.strike - spot) /
        spot
      : null;

  return {
    code: wall.code,
    strike: wall.strike,
    open_interest: wall.openInterest!,
    share_of_put_oi: share,
    distance_pct: distance,
  };
}

function activePutBuying(
  puts: OptionContract[],
  previous: Record<string, number> | null | undefined,
): ActivePutBuyingEstimate | null {
  if (!previous) return null;

  let positiveDeltaTotal = 0;
  let weightedAggressor = 0;

  for (const put of puts) {
    if (!finite(put.openInterest)) continue;

    const old = previous[put.code];

    if (!finite(old)) continue;

    const delta =
      put.openInterest - old;

    if (delta <= 0) continue;

    if (
      !finite(put.bid) ||
      !finite(put.ask) ||
      !finite(put.last)
    ) {
      continue;
    }

    let askProximity = 0.5;

    if (put.ask > put.bid) {
      askProximity = clamp(
        (put.last - put.bid) /
          (put.ask - put.bid),
      );
    }

    positiveDeltaTotal += delta;

    weightedAggressor +=
      delta * askProximity;
  }

  if (positiveDeltaTotal <= 0) {
    return null;
  }

  return {
    score_0_1:
      weightedAggressor /
      positiveDeltaTotal,

    data_kind: "estimate",

    basis:
      "positive put OI delta weighted by last-price proximity to ask; not official aggressor-side or dark-pool data",
  };
}

function pressureLevel(
  score: number,
): PutPressureResult["pressure_level"] {
  if (score < 30) return "low";
  if (score < 50) return "neutral";
  if (score < 65) return "elevated";
  if (score < 80) return "high";

  return "extreme";
}

function component(
  name: ScoreComponent["name"],
  weight: number,
  signal: number | null,
): ScoreComponent {
  return {
    name,
    weight,
    available: signal !== null,
    signal_0_1:
      signal === null
        ? null
        : clamp(signal),

    weighted_points:
      signal === null
        ? 0
        : weight * clamp(signal),
  };
}

export function computePutPressure(
  input: PutPressureInput,
): PutPressureResult {
  const calls = input.contracts.filter(
    (contract) =>
      contract.side === "call",
  );

  const puts = input.contracts.filter(
    (contract) =>
      contract.side === "put",
  );

  const callVolume =
    sumField(calls, "volume");

  const putVolume =
    sumField(puts, "volume");

  const callOi =
    sumField(calls, "openInterest");

  const putOi =
    sumField(puts, "openInterest");

  const pcrVolume =
    ratio(putVolume, callVolume);

  const pcrOi =
    ratio(putOi, callOi);

  const putDelta =
    matchedOiDelta(
      puts,
      input.previousOpenInterest,
    );

  const callDelta =
    matchedOiDelta(
      calls,
      input.previousOpenInterest,
    );

  const putOiDeltaRatio =
    putDelta.delta !== null &&
      putDelta.previousTotal !== null
      ? ratio(
        putDelta.delta,
        putDelta.previousTotal,
      )
      : null;

  const ivSkew =
    computeIvSkew(calls, puts);

  const putWall =
    computePutWall(
      puts,
      putOi,
      input.underlyingSpot,
    );

  const active =
    activePutBuying(
      puts,
      input.previousOpenInterest,
    );

  const wallSignal =
    putWall
      ? clamp(
        (
          clamp(
            putWall.share_of_put_oi /
              0.20,
          )
        ) *
          (
            putWall.distance_pct === null
              ? 0.5
              : clamp(
                1 -
                  putWall.distance_pct /
                    0.10,
              )
          ),
      )
      : null;

  const components: ScoreComponent[] = [
    component(
      "pcr_volume",
      25,
      pcrVolume === null
        ? null
        : scale(pcrVolume, 0.70, 1.50),
    ),

    component(
      "pcr_oi",
      20,
      pcrOi === null
        ? null
        : scale(pcrOi, 0.80, 1.50),
    ),

    component(
      "put_oi_delta",
      20,
      putOiDeltaRatio === null
        ? null
        : scale(
          putOiDeltaRatio,
          0,
          0.15,
        ),
    ),

    component(
      "iv_skew",
      20,
      ivSkew === null
        ? null
        : scale(ivSkew, 0, 0.08),
    ),

    component(
      "put_wall",
      10,
      wallSignal,
    ),

    component(
      "active_put_buying",
      5,
      active?.score_0_1 ?? null,
    ),
  ];

  const availableWeight =
    components.reduce(
      (sum, c) =>
        c.available
          ? sum + c.weight
          : sum,
      0,
    );

  const earnedPoints =
    components.reduce(
      (sum, c) =>
        sum + c.weighted_points,
      0,
    );

  const pressureScore =
    availableWeight > 0
      ? clamp(
        earnedPoints /
          availableWeight,
      ) * 100
      : 0;

  const completeness =
    availableWeight / 100;

  const notes: string[] = [
    "pressure_score is a transparent heuristic risk-gate signal, not a forecast probability",
    "IV skew uses matched call/put strikes and normalizes IV values expressed as either decimals or percentages",
    "delta OI only compares contracts present in the previous snapshot",
  ];

  if (!input.previousOpenInterest) {
    notes.push(
      "previous snapshot unavailable: delta OI and active put buying estimate are intentionally omitted",
    );
  }

  return {
    pcr_volume: pcrVolume,
    pcr_oi: pcrOi,

    put_oi_delta: putDelta.delta,
    call_oi_delta: callDelta.delta,
    put_oi_delta_ratio: putOiDeltaRatio,

    iv_skew: ivSkew,

    put_wall: putWall,

    active_put_buying_estimate:
      active,

    pressure_score:
      Math.round(
        pressureScore * 100,
      ) / 100,

    pressure_level:
      pressureLevel(
        pressureScore,
      ),

    completeness:
      Math.round(
        completeness * 1000,
      ) / 1000,

    components,

    data_kind: "derived",
    model_version:
      "put-pressure-heuristic-v1",

    notes,
  };
}
