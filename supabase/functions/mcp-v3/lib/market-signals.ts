export type IntradayBar = {
  time: string;

  open: number;
  high: number;
  low: number;
  close: number;

  volume: number;
};

export type BarVwap = {
  value: number | null;

  method:
    "typical_price_x_volume";

  data_kind: "estimate";

  note: string;
};

export type RelativeStrength = {
  bars: number;

  target_return_pct: number;
  benchmark_return_pct: number;

  relative_return_pct_points: number;
  relative_return_bps: number;

  data_kind: "derived";
};

export type TailWindow = {
  anchor: "14:00" | "14:30";

  first_time: string;
  last_time: string;

  open: number;
  close: number;

  high: number;
  low: number;

  volume: number;

  return_pct: number;

  close_location_0_1: number | null;

  vwap: BarVwap;
};

export type TailSession = {
  since_1400: TailWindow | null;
  since_1430: TailWindow | null;

  volume_share_since_1430:
    number | null;

  data_kind: "derived";
};

export type IntradaySignals = {
  vwap: BarVwap;

  last_price: number | null;

  vwap_distance_pct:
    number | null;

  vwap_state:
    | "above"
    | "below"
    | "at"
    | "unavailable";

  rs_15m:
    RelativeStrength | null;

  rs_30m:
    RelativeStrength | null;

  tail: TailSession;

  completeness: number;

  data_kind: "derived";

  notes: string[];
};

function finite(
  value: number,
): boolean {
  return Number.isFinite(value);
}

function validBar(
  bar: IntradayBar,
): boolean {
  return (
    finite(bar.open) &&
    finite(bar.high) &&
    finite(bar.low) &&
    finite(bar.close) &&
    finite(bar.volume) &&
    bar.volume >= 0
  );
}

function clean(
  bars: IntradayBar[],
): IntradayBar[] {
  return bars
    .filter(validBar)
    .slice()
    .sort(
      (a, b) =>
        a.time.localeCompare(b.time),
    );
}

export function computeBarVwap(
  input: IntradayBar[],
): BarVwap {
  const bars = clean(input);

  let weighted = 0;
  let volume = 0;

  for (const bar of bars) {
    if (bar.volume <= 0) {
      continue;
    }

    const typical =
      (
        bar.high +
        bar.low +
        bar.close
      ) / 3;

    weighted +=
      typical * bar.volume;

    volume += bar.volume;
  }

  return {
    value:
      volume > 0
        ? weighted / volume
        : null,

    method:
      "typical_price_x_volume",

    data_kind: "estimate",

    note:
      "bar VWAP is estimated from bar typical price weighted by reported bar volume; it is not tick-exact exchange VWAP",
  };
}

function windowReturn(
  input: IntradayBar[],
  count: number,
): number | null {
  const bars =
    clean(input);

  if (
    bars.length < count ||
    count <= 0
  ) {
    return null;
  }

  const selected =
    bars.slice(-count);

  const first =
    selected[0];

  const last =
    selected[
      selected.length - 1
    ];

  if (
    first.open <= 0 ||
    last.close <= 0
  ) {
    return null;
  }

  return (
    last.close /
      first.open -
    1
  );
}

export function computeRelativeStrength(
  targetInput: IntradayBar[],
  benchmarkInput: IntradayBar[],
  bars: number,
): RelativeStrength | null {
  const target =
    windowReturn(
      targetInput,
      bars,
    );

  const benchmark =
    windowReturn(
      benchmarkInput,
      bars,
    );

  if (
    target === null ||
    benchmark === null
  ) {
    return null;
  }

  const relative =
    target - benchmark;

  return {
    bars,

    target_return_pct:
      target * 100,

    benchmark_return_pct:
      benchmark * 100,

    relative_return_pct_points:
      relative * 100,

    relative_return_bps:
      relative * 10000,

    data_kind: "derived",
  };
}

function hhmm(
  value: string,
): number | null {
  const digits =
    value.replace(/\D/g, "");

  if (digits.length < 4) {
    return null;
  }

  const hhmmText =
    digits.slice(-4);

  const h =
    Number(
      hhmmText.slice(0, 2),
    );

  const m =
    Number(
      hhmmText.slice(2, 4),
    );

  if (
    !Number.isInteger(h) ||
    !Number.isInteger(m) ||
    h < 0 ||
    h > 23 ||
    m < 0 ||
    m > 59
  ) {
    return null;
  }

  return h * 60 + m;
}

function tailWindow(
  input: IntradayBar[],
  anchorMinutes: number,
  anchor:
    "14:00" | "14:30",
): TailWindow | null {
  const bars =
    clean(input).filter(
      (bar) => {
        const minute =
          hhmm(bar.time);

        return (
          minute !== null &&
          minute >=
            anchorMinutes
        );
      },
    );

  if (!bars.length) {
    return null;
  }

  const first = bars[0];
  const last =
    bars[bars.length - 1];

  if (first.open <= 0) {
    return null;
  }

  const high =
    Math.max(
      ...bars.map(
        (x) => x.high,
      ),
    );

  const low =
    Math.min(
      ...bars.map(
        (x) => x.low,
      ),
    );

  const volume =
    bars.reduce(
      (sum, x) =>
        sum + x.volume,
      0,
    );

  const range =
    high - low;

  const closeLocation =
    range > 0
      ? (
        last.close - low
      ) / range
      : null;

  return {
    anchor,

    first_time: first.time,
    last_time: last.time,

    open: first.open,
    close: last.close,

    high,
    low,

    volume,

    return_pct:
      (
        last.close /
          first.open -
        1
      ) * 100,

    close_location_0_1:
      closeLocation,

    vwap:
      computeBarVwap(bars),
  };
}

export function computeTailSession(
  input: IntradayBar[],
): TailSession {
  const bars = clean(input);

  const since1400 =
    tailWindow(
      bars,
      14 * 60,
      "14:00",
    );

  const since1430 =
    tailWindow(
      bars,
      14 * 60 + 30,
      "14:30",
    );

  const totalVolume =
    since1400?.volume ?? 0;

  const lateVolume =
    since1430?.volume ?? 0;

  return {
    since_1400:
      since1400,

    since_1430:
      since1430,

    volume_share_since_1430:
      totalVolume > 0 &&
        since1430
        ? lateVolume /
          totalVolume
        : null,

    data_kind: "derived",
  };
}

export function computeIntradaySignals(
  targetInput: IntradayBar[],
  benchmarkInput: IntradayBar[],
): IntradaySignals {
  const target =
    clean(targetInput);

  const benchmark =
    clean(benchmarkInput);

  const vwap =
    computeBarVwap(target);

  const lastPrice =
    target.length
      ? target[
        target.length - 1
      ].close
      : null;

  let vwapDistance:
    number | null = null;

  let vwapState:
    IntradaySignals[
      "vwap_state"
    ] = "unavailable";

  if (
    lastPrice !== null &&
    vwap.value !== null &&
    vwap.value > 0
  ) {
    vwapDistance =
      (
        lastPrice /
          vwap.value -
        1
      ) * 100;

    if (
      Math.abs(
        vwapDistance,
      ) < 0.001
    ) {
      vwapState = "at";
    } else {
      vwapState =
        vwapDistance > 0
          ? "above"
          : "below";
    }
  }

  const rs15 =
    computeRelativeStrength(
      target,
      benchmark,
      3,
    );

  const rs30 =
    computeRelativeStrength(
      target,
      benchmark,
      6,
    );

  const tail =
    computeTailSession(
      target,
    );

  const availability = [
    vwap.value !== null,
    rs15 !== null,
    rs30 !== null,
    tail.since_1400 !== null,
    tail.since_1430 !== null,
  ];

  const completeness =
    availability.filter(Boolean)
      .length /
    availability.length;

  return {
    vwap,

    last_price:
      lastPrice,

    vwap_distance_pct:
      vwapDistance,

    vwap_state:
      vwapState,

    rs_15m:
      rs15,

    rs_30m:
      rs30,

    tail,

    completeness,

    data_kind: "derived",

    notes: [
      "15m/30m RS is target return minus benchmark return over matched 5-minute bar windows",
      "VWAP is a bar-derived approximation, not tick-exact exchange VWAP",
      "14:00 and 14:30 tail windows are retained separately for late-session decision rules",
    ],
  };
}
