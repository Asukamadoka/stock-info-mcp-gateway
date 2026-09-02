export type TencentQuoteData = {
  source: "tencent";
  symbol: string;
  code: string;
  name: string | null;

  price: string | null;
  prev_close: string | null;
  open: string | null;
  volume: string | null;

  bid: string | null;
  ask: string | null;

  time: string | null;

  change: string | null;
  change_percent: string | null;

  high: string | null;
  low: string | null;

  turnover_amount: string | null;
  turnover_rate: string | null;
  pe_ttm: string | null;
};

export function parseTencentQuotePayload(
  text: string,
  symbol: string,
): TencentQuoteData {
  // Intentionally mirrors the current production bug
  // so the RED test exercises behavior rather than
  // failing because the module does not exist.
  const m =
    text.match(/="([\s\S]*?)"/);

  if (!m) {
    throw new Error(
      "bad Tencent quote payload",
    );
  }

  const f = m[1].split("~");

  return {
    source: "tencent",
    symbol,

    code:
      f[2] ||
      symbol.slice(2),

    name:
      f[1] || null,

    price:
      f[3] || null,

    prev_close:
      f[4] || null,

    open:
      f[5] || null,

    volume:
      f[6] || null,

    bid:
      f[9] || null,

    ask:
      f[19] || null,

    time:
      f[30] || null,

    change:
      f[31] || null,

    change_percent:
      f[32] || null,

    high:
      f[33] || null,

    low:
      f[34] || null,

    turnover_amount:
      f[37] || null,

    turnover_rate:
      f[38] || null,

    pe_ttm:
      f[39] || null,
  };
}
