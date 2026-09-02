import {
  assertEquals,
} from "jsr:@std/assert@1";

Deno.test("mcp-v3 exposes fund-flow consensus and candidate score", async () => {
  const source =
    await Deno.readTextFile(
      "supabase/functions/mcp-v3/index.ts",
    );

  for (
    const expected of [
      'name:"fund_flow_consensus"',
      'name:"candidate_score"',
      "computeFundFlowConsensus",
      "computeCandidateScore",
      "buildFlowObservations",
      "technicalScoreFromIntraday",
      "async function fundFlowConsensus",
      "async function candidateScore",
    ]
  ) {
    assertEquals(
      source.includes(expected),
      true,
      expected,
    );
  }
});

Deno.test("proxy flow does not count as verified flow-chip availability", async () => {
  const source =
    await Deno.readTextFile(
      "supabase/functions/mcp-v3/index.ts",
    );

  const unsafeProxyAvailability =
    /flowChipDataAvailable:\s*ctx\.flow\s*\.signal_1_to_1\s*!==\s*null/
      .test(source);

  assertEquals(
    unsafeProxyAvailability,
    false,
    "price-volume/orderbook proxy consensus must not unlock verified flow-chip availability",
  );
});
