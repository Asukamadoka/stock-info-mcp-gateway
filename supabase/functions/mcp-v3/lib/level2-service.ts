import {
  classifyProviderError,
  type ProviderStatus,
} from "./source-result.ts";

import type {
  ItickDepthResult,
  L2Market,
} from "./level2.ts";

export type Level2ServiceResult = {
  source: "itick-depth";
  source_family: "itick";

  source_timestamp: string | null;
  fetched_at: string;

  stale: boolean | null;
  confidence: number;

  data_kind: "raw";

  status: ProviderStatus;

  data: ItickDepthResult | null;
  error: string | null;
};

type Args = {
  code: string;
  market: L2Market;

  tokenLoader:
    () => Promise<string>;

  depthFetcher:
    (args: {
      token: string;
      code: string;
      market: L2Market;
    }) => Promise<ItickDepthResult>;

  now?: () => Date;
};

export async function getLevel2OrderBook(
  args: Args,
): Promise<Level2ServiceResult> {
  const fetchedAt =
    (args.now ?? (() => new Date()))()
      .toISOString();

  let token: string;

  try {
    token =
      await args.tokenLoader();

    if (!token) {
      throw new Error(
        "empty token",
      );
    }
  } catch {
    return {
      source: "itick-depth",
      source_family: "itick",

      source_timestamp: null,
      fetched_at: fetchedAt,

      stale: null,
      confidence: 0,

      data_kind: "raw",

      status: "unavailable",

      data: null,

      error:
        "iTick token unavailable",
    };
  }

  try {
    const result =
      await args.depthFetcher({
        token,
        code: args.code,
        market: args.market,
      });

    return {
      source: "itick-depth",
      source_family: "itick",

      source_timestamp:
        result.source_timestamp,

      fetched_at: fetchedAt,

      // REST depth payload currently
      // has no reliable source timestamp.
      stale: null,

      // Unknown freshness caps
      // confidence at 0.70.
      confidence: 0.70,

      data_kind: "raw",

      status: "ok",

      data: result,
      error: null,
    };
  } catch (error) {
    return {
      source: "itick-depth",
      source_family: "itick",

      source_timestamp: null,
      fetched_at: fetchedAt,

      stale: null,
      confidence: 0,

      data_kind: "raw",

      status:
        classifyProviderError(
          error,
        ),

      data: null,

      error:
        error instanceof Error
          ? error.message
          : String(error),
    };
  }
}
