import {
  assert,
  assertEquals,
} from "jsr:@std/assert@1";

import {
  computeCandidateScore,
} from "./candidate-score.ts";

Deno.test("candidate score uses 25/25/20/20/10 weights", () => {
  const r =
    computeCandidateScore({
      sectorCatalyst: 100,
      earningsValuation: 80,
      technical: 70,
      flowChips: 60,
      payoffTriggers: 50,

      critical1430Available:
        true,

      flowChipDataAvailable:
        true,

      vetoes: {},
    });

  assertEquals(
    r.raw_score,
    76,
  );

  assertEquals(
    r.final_score,
    76,
  );

  assertEquals(
    r.eligible,
    true,
  );
});

Deno.test("missing critical 14:30 data caps grade at B+", () => {
  const r =
    computeCandidateScore({
      sectorCatalyst: 100,
      earningsValuation: 100,
      technical: 100,
      flowChips: 100,
      payoffTriggers: 100,

      critical1430Available:
        false,

      flowChipDataAvailable:
        true,

      vetoes: {},
    });

  assertEquals(
    r.raw_score,
    100,
  );

  assertEquals(
    r.final_grade,
    "B+",
  );

  assertEquals(
    r.grade_cap,
    "B+",
  );
});

Deno.test("missing flow-chip data also caps grade at B+", () => {
  const r =
    computeCandidateScore({
      sectorCatalyst: 90,
      earningsValuation: 90,
      technical: 90,
      flowChips: null,
      payoffTriggers: 90,

      critical1430Available:
        true,

      flowChipDataAvailable:
        false,

      vetoes: {},
    });

  assertEquals(
    r.raw_score,
    72,
  );

  assertEquals(
    r.raw_grade,
    "B",
  );

  assertEquals(
    r.grade_cap,
    "B+",
  );

  // B+ is a ceiling, not a floor:
  // missing flow/chip data must never
  // upgrade a weaker raw score.
  assertEquals(
    r.final_grade,
    "B",
  );

  assertEquals(
    r.completeness,
    0.8,
  );
});

Deno.test("hard veto makes candidate ineligible", () => {
  const r =
    computeCandidateScore({
      sectorCatalyst: 95,
      earningsValuation: 95,
      technical: 95,
      flowChips: 95,
      payoffTriggers: 95,

      critical1430Available:
        true,

      flowChipDataAvailable:
        true,

      vetoes: {
        majorFundamentalRisk:
          true,
      },
    });

  assertEquals(
    r.eligible,
    false,
  );

  assertEquals(
    r.final_grade,
    "VETO",
  );

  assertEquals(
    r.veto_reasons,
    [
      "major_fundamental_risk",
    ],
  );
});

Deno.test("all four trading hard-veto classes are explicit", () => {
  const r =
    computeCandidateScore({
      sectorCatalyst: 80,
      earningsValuation: 80,
      technical: 80,
      flowChips: 80,
      payoffTriggers: 80,

      critical1430Available:
        true,

      flowChipDataAvailable:
        true,

      vetoes: {
        unjustifiedValuation:
          true,

        relativeWeaknessDespiteCatalyst:
          true,

        sustainedLargeFundWithdrawal:
          true,

        cashFlowProfitDivergence:
          true,

        majorFundamentalRisk:
          true,
      },
    });

  assertEquals(
    r.veto_reasons.length,
    5,
  );

  assertEquals(
    r.eligible,
    false,
  );
});
