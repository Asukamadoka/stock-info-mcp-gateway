import { assertEquals } from "jsr:@std/assert@1";
import {
  buildSourceResult,
  classifyProviderError,
  parseCnQuoteTimestamp,
  runFallback,
} from "./source-result.ts";

Deno.test("parseCnQuoteTimestamp converts Tencent CN timestamp", () => {
  assertEquals(
    parseCnQuoteTimestamp("20260902102530"),
    "2026-09-02T10:25:30+08:00",
  );
});

Deno.test("fresh source result keeps confidence", () => {
  const r = buildSourceResult({
    source: "tencent-quote",
    sourceFamily: "tencent",
    sourceTimestamp: "2026-09-02T10:25:30+08:00",
    fetchedAt: "2026-09-02T10:26:00+08:00",
    maxAgeMs: 120_000,
    confidence: 0.95,
    dataKind: "raw",
    data: { price: 10 },
  });

  assertEquals(r.stale, false);
  assertEquals(r.confidence, 0.95);
  assertEquals(r.status, "ok");
});

Deno.test("old source is marked stale and confidence is capped", () => {
  const r = buildSourceResult({
    source: "tencent-quote",
    sourceFamily: "tencent",
    sourceTimestamp: "2026-09-02T10:20:00+08:00",
    fetchedAt: "2026-09-02T10:26:00+08:00",
    maxAgeMs: 120_000,
    confidence: 0.95,
    dataKind: "raw",
    data: { price: 10 },
  });

  assertEquals(r.stale, true);
  assertEquals(r.confidence, 0.55);
});

Deno.test("missing source timestamp is explicitly unknown", () => {
  const r = buildSourceResult({
    source: "hithink-a-share",
    sourceFamily: "hithink",
    sourceTimestamp: null,
    fetchedAt: "2026-09-02T10:26:00+08:00",
    maxAgeMs: 120_000,
    confidence: 0.9,
    dataKind: "raw",
    data: { price: 10 },
  });

  assertEquals(r.stale, null);
  assertEquals(r.confidence, 0.7);
});

Deno.test("provider errors distinguish permission and quota", () => {
  assertEquals(
    classifyProviderError(new Error("HTTP 403 permission denied")),
    "permission",
  );

  assertEquals(
    classifyProviderError(new Error("HTTP 429 rate limit exceeded")),
    "quota",
  );
});

Deno.test("fallback skips failed provider and selects next fresh provider", async () => {
  const result = await runFallback([
    {
      source: "primary",
      sourceFamily: "primary-family",
      confidence: 0.95,
      maxAgeMs: 120_000,
      fetch: async () => {
        throw new Error("HTTP 429 rate limit exceeded");
      },
    },
    {
      source: "backup",
      sourceFamily: "backup-family",
      confidence: 0.85,
      maxAgeMs: 120_000,
      fetch: async () => ({
        data: { price: 12.34 },
        sourceTimestamp: "2026-09-02T10:25:30+08:00",
      }),
    },
  ], "2026-09-02T10:26:00+08:00");

  assertEquals(result.selected?.source, "backup");
  assertEquals(result.selected?.data, { price: 12.34 });

  assertEquals(result.attempts[0].status, "quota");
  assertEquals(result.attempts[1].status, "ok");
});

Deno.test("fallback prefers fresh result over earlier stale result", async () => {
  const result = await runFallback([
    {
      source: "stale-primary",
      sourceFamily: "family-a",
      confidence: 0.95,
      maxAgeMs: 120_000,
      fetch: async () => ({
        data: { price: 10 },
        sourceTimestamp: "2026-09-02T10:20:00+08:00",
      }),
    },
    {
      source: "fresh-backup",
      sourceFamily: "family-b",
      confidence: 0.8,
      maxAgeMs: 120_000,
      fetch: async () => ({
        data: { price: 10.01 },
        sourceTimestamp: "2026-09-02T10:25:30+08:00",
      }),
    },
  ], "2026-09-02T10:26:00+08:00");

  assertEquals(result.selected?.source, "fresh-backup");
});
