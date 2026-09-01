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
