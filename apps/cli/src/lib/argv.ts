const TOP_LEVEL_ROUTES = new Set(["chat", "coworker", "auth", "hi"]);
const ROOT_PASSTHROUGH_FLAGS = new Set(["--help", "-h", "--version", "-v"]);
const KEBAB_FLAG_ALIASES = new Map<string, string>([
  ["--auth-source", "--authSource"],
  ["--list-models", "--listModels"],
  ["--no-list-models", "--noListModels"],
  ["--auto-approve", "--autoApprove"],
  ["--no-auto-approve", "--noAutoApprove"],
  ["--question-answer", "--questionAnswer"],
  ["--perfetto-trace", "--perfettoTrace"],
  ["--no-perfetto-trace", "--noPerfettoTrace"],
  ["--chaos-run-deadline", "--chaosRunDeadline"],
  ["--chaos-approval", "--chaosApproval"],
  ["--chaos-approval-park-after", "--chaosApprovalParkAfter"],
  ["--attach-generation", "--attachGeneration"],
  ["--no-validate", "--noValidate"],
]);

export function normalizeCmdclawArgv(argv: string[]): string[] {
  const normalizedFlags = argv.map((arg) => KEBAB_FLAG_ALIASES.get(arg) ?? arg);
  if (normalizedFlags.length === 0) {
    return ["chat"];
  }

  const first = normalizedFlags[0];
  if (!first) {
    return ["chat"];
  }

  if (ROOT_PASSTHROUGH_FLAGS.has(first)) {
    return normalizedFlags;
  }

  if (TOP_LEVEL_ROUTES.has(first)) {
    return normalizedFlags;
  }

  return ["chat", ...normalizedFlags];
}
