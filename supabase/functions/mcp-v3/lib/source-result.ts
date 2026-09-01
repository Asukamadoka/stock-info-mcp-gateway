export type DataKind = "raw" | "derived" | "estimate";

export type ProviderStatus =
  | "ok"
  | "permission"
  | "quota"
  | "unavailable"
  | "error";

export type SourceResult<T> = {
  source: string;
  source_family: string;

  source_timestamp: string | null;
  fetched_at: string;

  stale: boolean | null;
  confidence: number;

  data_kind: DataKind;
  status: ProviderStatus;

  data: T | null;
  error: string | null;
};

type BuildResultArgs<T> = {
  source: string;
  sourceFamily: string;

  sourceTimestamp: string | null;
  fetchedAt: string;

  maxAgeMs: number;
  confidence: number;

  dataKind: DataKind;
  data: T;
};

export function parseCnQuoteTimestamp(
  value: string | null | undefined,
): string | null {
  if (!value) return null;

  const s = String(value).trim();

  if (!/^\d{14}$/.test(s)) return null;

  return (
    `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` +
    `T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}+08:00`
  );
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function buildSourceResult<T>(
  args: BuildResultArgs<T>,
): SourceResult<T> {
  let stale: boolean | null = null;

  if (args.sourceTimestamp) {
    const sourceMs = Date.parse(args.sourceTimestamp);
    const fetchedMs = Date.parse(args.fetchedAt);

    if (Number.isFinite(sourceMs) && Number.isFinite(fetchedMs)) {
      stale = fetchedMs - sourceMs > args.maxAgeMs;
    }
  }

  let confidence = clampConfidence(args.confidence);

  if (stale === true) {
    confidence = Math.min(confidence, 0.55);
  } else if (stale === null) {
    confidence = Math.min(confidence, 0.70);
  }

  return {
    source: args.source,
    source_family: args.sourceFamily,

    source_timestamp: args.sourceTimestamp,
    fetched_at: args.fetchedAt,

    stale,
    confidence,

    data_kind: args.dataKind,
    status: "ok",

    data: args.data,
    error: null,
  };
}

export function classifyProviderError(
  error: unknown,
): Exclude<ProviderStatus, "ok"> {
  const text = error instanceof Error
    ? error.message.toLowerCase()
    : String(error).toLowerCase();

  if (
    text.includes("401") ||
    text.includes("403") ||
    text.includes("permission") ||
    text.includes("no access") ||
    text.includes("40203")
  ) {
    return "permission";
  }

  if (
    text.includes("429") ||
    text.includes("quota") ||
    text.includes("rate limit") ||
    text.includes("too many")
  ) {
    return "quota";
  }

  if (
    text.includes("timeout") ||
    text.includes("network") ||
    text.includes("fetch") ||
    text.includes("502") ||
    text.includes("503") ||
    text.includes("504")
  ) {
    return "unavailable";
  }

  return "error";
}

type ProviderPayload<T> = {
  data: T;
  sourceTimestamp: string | null;
};

export type FallbackProvider<T> = {
  source: string;
  sourceFamily: string;
  confidence: number;
  maxAgeMs: number;

  dataKind?: DataKind;

  fetch: () => Promise<ProviderPayload<T>>;
};

export type FallbackResult<T> = {
  selected: SourceResult<T> | null;
  attempts: SourceResult<T>[];
};

function rank<T>(r: SourceResult<T>): number {
  if (r.status !== "ok") return 0;
  if (r.stale === false) return 3;
  if (r.stale === null) return 2;
  return 1;
}

export async function runFallback<T>(
  providers: FallbackProvider<T>[],
  fetchedAt = new Date().toISOString(),
): Promise<FallbackResult<T>> {
  const attempts: SourceResult<T>[] = [];

  for (const provider of providers) {
    try {
      const payload = await provider.fetch();

      const result = buildSourceResult({
        source: provider.source,
        sourceFamily: provider.sourceFamily,

        sourceTimestamp: payload.sourceTimestamp,
        fetchedAt,

        maxAgeMs: provider.maxAgeMs,
        confidence: provider.confidence,

        dataKind: provider.dataKind ?? "raw",
        data: payload.data,
      });

      attempts.push(result);

      if (result.stale === false) {
        return {
          selected: result,
          attempts,
        };
      }
    } catch (error) {
      attempts.push({
        source: provider.source,
        source_family: provider.sourceFamily,

        source_timestamp: null,
        fetched_at: fetchedAt,

        stale: null,
        confidence: 0,

        data_kind: provider.dataKind ?? "raw",
        status: classifyProviderError(error),

        data: null,
        error: error instanceof Error
          ? error.message
          : String(error),
      });
    }
  }

  const usable = attempts
    .filter((x) => x.status === "ok")
    .sort((a, b) => {
      const rankDiff = rank(b) - rank(a);

      if (rankDiff !== 0) return rankDiff;

      return b.confidence - a.confidence;
    });

  return {
    selected: usable[0] ?? null,
    attempts,
  };
}
