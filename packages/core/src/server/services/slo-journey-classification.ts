export const SLO_CONCRETE_JOURNEYS = ["chat", "coworker_builder", "coworker_run"] as const;
export const SLO_METRIC_JOURNEYS = ["global", ...SLO_CONCRETE_JOURNEYS] as const;
export const SLO_RESULTS = ["good", "bad"] as const;
export const SLO_TRAFFIC_TYPES = ["real", "synthetic"] as const;

export type SloConcreteJourney = (typeof SLO_CONCRETE_JOURNEYS)[number];
export type SloMetricJourney = (typeof SLO_METRIC_JOURNEYS)[number];
export type SloResult = (typeof SLO_RESULTS)[number];
export type SloTraffic = (typeof SLO_TRAFFIC_TYPES)[number];

export type SloMetricSample = {
  journey: SloMetricJourney;
  result: SloResult;
  traffic: SloTraffic;
};

export type SloTerminalFacts = {
  journey: SloConcreteJourney;
  status: string;
  completionReason?: string | null;
  traffic?: SloTraffic;
};

export function resolveSloTraffic(syntheticKind?: string | null): SloTraffic {
  return syntheticKind === "slo_replay" ? "synthetic" : "real";
}

export function classifySloResult(input: {
  status: string;
  completionReason?: string | null;
}): SloResult {
  if (input.status === "completed") {
    return "good";
  }
  if (input.status === "cancelled") {
    const reason = input.completionReason ?? "user_cancel";
    return reason === "user_cancel" || reason === "cancelled" ? "good" : "bad";
  }
  return "bad";
}

export function classifySloTerminalEvent(facts: SloTerminalFacts): SloMetricSample[] {
  const result = classifySloResult({
    status: facts.status,
    completionReason: facts.completionReason,
  });
  const traffic = facts.traffic ?? "real";
  return [
    { journey: facts.journey, result, traffic },
    { journey: "global", result, traffic },
  ];
}
