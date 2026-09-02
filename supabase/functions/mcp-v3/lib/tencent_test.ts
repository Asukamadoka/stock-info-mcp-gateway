import {
  assertEquals,
} from "jsr:@std/assert@1";

import {
  parseTencentQuotePayload,
} from "./tencent.ts";

Deno.test("parses standard Tencent quote payload", () => {
  const text =
    'v_sh600519="1~贵州茅台~600519~1299.56~1299.52~1295.00";';

  const r =
    parseTencentQuotePayload(
      text,
      "sh600519",
    );

  assertEquals(r.symbol, "sh600519");
  assertEquals(r.name, "贵州茅台");
  assertEquals(r.code, "600519");
  assertEquals(r.price, "1299.56");
});
