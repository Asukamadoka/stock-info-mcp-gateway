export type CandidateGrade =
  | "A+"
  | "A"
  | "A-"
  | "B+"
  | "B"
  | "B-"
  | "C"
  | "D"
  | "VETO";

export type CandidateVetoes = {
  unjustifiedValuation?: boolean;

  relativeWeaknessDespiteCatalyst?:
    boolean;

  sustainedLargeFundWithdrawal?:
    boolean;

  cashFlowProfitDivergence?:
    boolean;

  majorFundamentalRisk?:
    boolean;
};

export type CandidateScoreInput = {
  // 25%
  sectorCatalyst:
    number | null;

  // 25%
  earningsValuation:
    number | null;

  // 20%
  technical:
    number | null;

  // 20%
  flowChips:
    number | null;

  // 10%
  payoffTriggers:
    number | null;

  critical1430Available:
    boolean;

  flowChipDataAvailable:
    boolean;

  vetoes:
    CandidateVetoes;
};

type Component = {
  name:
    | "sector_catalyst"
    | "earnings_valuation"
    | "technical"
    | "flow_chips"
    | "payoff_triggers";

  weight: number;

  score: number | null;

  weighted_points: number;
};

export type CandidateScoreResult = {
  raw_score: number;
  final_score: number;

  raw_grade: CandidateGrade;
  final_grade: CandidateGrade;

  grade_cap:
    | "B+"
    | null;

  eligible: boolean;

  completeness: number;

  components: Component[];

  veto_reasons: string[];

  model_version:
    "candidate-score-v1";

  notes: string[];
};

function clampScore(
  x: number | null,
): number | null {
  if (
    x === null ||
    !Number.isFinite(x)
  ) {
    return null;
  }

  return Math.max(
    0,
    Math.min(100, x),
  );
}

function grade(
  score: number,
): CandidateGrade {
  if (score >= 90) return "A+";
  if (score >= 85) return "A";
  if (score >= 80) return "A-";
  if (score >= 75) return "B+";
  if (score >= 70) return "B";
  if (score >= 65) return "B-";
  if (score >= 55) return "C";

  return "D";
}

const gradeRank:
  Record<
    CandidateGrade,
    number
  > = {
    "VETO": 0,
    "D": 1,
    "C": 2,
    "B-": 3,
    "B": 4,
    "B+": 5,
    "A-": 6,
    "A": 7,
    "A+": 8,
  };

function capGrade(
  value: CandidateGrade,
  cap: "B+" | null,
): CandidateGrade {
  if (!cap) return value;

  return gradeRank[value] >
      gradeRank[cap]
    ? cap
    : value;
}

export function computeCandidateScore(
  input: CandidateScoreInput,
): CandidateScoreResult {
  const config: Omit<Component, "weighted_points">[] = [
    {
      name:
        "sector_catalyst",

      weight: 25,

      score:
        clampScore(
          input.sectorCatalyst,
        ),
    },
    {
      name:
        "earnings_valuation",

      weight: 25,

      score:
        clampScore(
          input.earningsValuation,
        ),
    },
    {
      name:
        "technical",

      weight: 20,

      score:
        clampScore(
          input.technical,
        ),
    },
    {
      name:
        "flow_chips",

      weight: 20,

      score:
        clampScore(
          input.flowChips,
        ),
    },
    {
      name:
        "payoff_triggers",

      weight: 10,

      score:
        clampScore(
          input.payoffTriggers,
        ),
    },
  ];

  const components:
    Component[] =
    config.map(
      (x) => ({
        ...x,

        weighted_points:
          x.score === null
            ? 0
            : (
              x.score *
              x.weight /
              100
            ),
      }),
    );

  const availableWeight =
    components.reduce(
      (sum, x) =>
        x.score === null
          ? sum
          : sum + x.weight,
      0,
    );

  const earned =
    components.reduce(
      (sum, x) =>
        sum +
        x.weighted_points,
      0,
    );

  // Missing components are not
  // silently reweighted upward.
  const rawScore =
    Math.round(
      earned * 100,
    ) / 100;

  const completeness =
    availableWeight / 100;

  const vetoReasons:
    string[] = [];

  if (
    input.vetoes
      .unjustifiedValuation
  ) {
    vetoReasons.push(
      "unjustified_valuation",
    );
  }

  if (
    input.vetoes
      .relativeWeaknessDespiteCatalyst
  ) {
    vetoReasons.push(
      "relative_weakness_despite_catalyst",
    );
  }

  if (
    input.vetoes
      .sustainedLargeFundWithdrawal
  ) {
    vetoReasons.push(
      "sustained_large_fund_withdrawal",
    );
  }

  if (
    input.vetoes
      .cashFlowProfitDivergence
  ) {
    vetoReasons.push(
      "cash_flow_profit_divergence",
    );
  }

  if (
    input.vetoes
      .majorFundamentalRisk
  ) {
    vetoReasons.push(
      "major_fundamental_risk",
    );
  }

  const hasVeto =
    vetoReasons.length > 0;

  const rawGrade =
    grade(rawScore);

  const needsCap =
    !input
      .critical1430Available ||
    !input
      .flowChipDataAvailable;

  const gradeCap =
    needsCap
      ? "B+"
      : null;

  const finalGrade =
    hasVeto
      ? "VETO"
      : capGrade(
        rawGrade,
        gradeCap,
      );

  return {
    raw_score:
      rawScore,

    final_score:
      rawScore,

    raw_grade:
      rawGrade,

    final_grade:
      finalGrade,

    grade_cap:
      gradeCap,

    eligible:
      !hasVeto,

    completeness:
      Math.round(
        completeness * 1000,
      ) / 1000,

    components,

    veto_reasons:
      vetoReasons,

    model_version:
      "candidate-score-v1",

    notes: [
      "weights are fixed at 25/25/20/20/10 for sector+catalyst, earnings+valuation, technical, flow+chips, payoff+triggers",
      "missing components are not reweighted upward",
      "missing critical 14:30 technical data or flow/chip data caps the final grade at B+",
      "hard vetoes override the numeric score and make the candidate ineligible",
    ],
  };
}
