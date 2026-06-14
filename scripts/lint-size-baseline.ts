type Diagnostic = {
  message: string;
  code: string;
  severity: string;
  filename: string;
  labels?: Array<{
    span?: {
      line?: number;
      column?: number;
    };
  }>;
};

type OxlintOutput = {
  diagnostics?: Diagnostic[];
  number_of_files?: number;
  number_of_rules?: number;
};

type Baseline = {
  rules: Record<string, Record<string, number>>;
};

type Failure = {
  diagnostic: Diagnostic;
  currentCount: number | null;
  baselineCount?: number;
  reason: string;
};

type JsonRecord = Record<string, unknown>;
type Location = {
  line: number;
  column: number;
};
type FailureCheck = {
  reason: string;
  baselineCount?: number;
};

const baselineUrl = new URL("../lint-baselines/size.json", import.meta.url);
const countPatterns: Record<string, RegExp> = {
  "eslint(max-lines)": /File has too many lines \((\d+)\)\./,
  "local(max-mocked-modules)": /This test mocks (\d+) distinct modules/,
};

function fail(message: string): never {
  console.error(`[lint:size] ${message}`);
  process.exit(1);
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireJsonRecord(value: unknown, label: string): JsonRecord {
  if (isJsonRecord(value)) {
    return value;
  }

  fail(`Invalid lint baseline: ${label} must be an object.`);
}

function requireBaselineCount(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  fail(`Invalid lint baseline: ${label} must be a non-negative integer.`);
}

function readRuleBaseline(ruleName: string, value: unknown): Record<string, number> {
  const entries = requireJsonRecord(value, `${ruleName} entries`);

  return Object.fromEntries(
    Object.entries(entries).map(([filename, count]) => [
      filename,
      requireBaselineCount(count, `${ruleName} entry ${filename}`),
    ]),
  );
}

async function readBaseline(): Promise<Baseline> {
  const baseline = requireJsonRecord(await Bun.file(baselineUrl).json(), "root");
  const rules = requireJsonRecord(baseline.rules, "rules");

  return {
    rules: Object.fromEntries(
      Object.entries(rules).map(([ruleName, entries]) => [
        ruleName,
        readRuleBaseline(ruleName, entries),
      ]),
    ),
  };
}

async function runOxlint(
  extraArgs: string[],
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const proc = Bun.spawn(
    [
      process.execPath,
      "x",
      "--bun",
      "oxlint",
      "--config",
      ".oxlintrc.json",
      "--format",
      "json",
      ...extraArgs,
      ".",
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, FORCE_COLOR: "0" },
    },
  );

  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();

  return {
    exitCode: await proc.exited,
    stdout: await stdoutPromise,
    stderr: await stderrPromise,
  };
}

function writeIfPresent(value: string): void {
  const trimmed = value.trim();
  if (trimmed) {
    console.error(trimmed);
  }
}

function parseJsonOutput(stdout: string, stderr: string): OxlintOutput {
  try {
    return JSON.parse(stdout) as OxlintOutput;
  } catch (error) {
    writeIfPresent(stdout);
    writeIfPresent(stderr);
    fail(`Could not parse Oxlint JSON output: ${(error as Error).message}`);
  }
}

function parseOxlintOutput(stdout: string, stderr: string, exitCode: number): OxlintOutput {
  const trimmed = stdout.trim();
  if (trimmed) {
    return parseJsonOutput(trimmed, stderr);
  }

  if (exitCode === 0) {
    return { diagnostics: [] };
  }

  writeIfPresent(stderr);
  fail(`Oxlint exited with ${exitCode} and did not produce JSON output.`);
}

function getCurrentCount(diagnostic: Diagnostic): number | null {
  const match = countPatterns[diagnostic.code]?.exec(diagnostic.message);

  return match ? Number(match[1]) : null;
}

function formatCountDetails(failure: Failure): string {
  if (failure.currentCount === null) {
    return "";
  }

  if (failure.baselineCount === undefined) {
    return ` current=${failure.currentCount}`;
  }

  return ` current=${failure.currentCount} baseline=${failure.baselineCount}`;
}

function getPrimarySpan(diagnostic: Diagnostic): { line?: number; column?: number } {
  return diagnostic.labels?.[0]?.span ?? {};
}

function toLocation(span: { line?: number; column?: number }): Location {
  return {
    line: span.line ?? 1,
    column: span.column ?? 1,
  };
}

function formatDiagnostic(failure: Failure): string {
  const { diagnostic } = failure;
  const { line, column } = toLocation(getPrimarySpan(diagnostic));

  return [
    `${diagnostic.filename}:${line}:${column}: ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`,
    `  ${failure.reason}${formatCountDetails(failure)}`,
  ].join("\n");
}

function createFailure(
  diagnostic: Diagnostic,
  currentCount: number | null,
  reason: string,
  baselineCount?: number,
): Failure {
  return { diagnostic, currentCount, baselineCount, reason };
}

function getBaselineCount(diagnostic: Diagnostic, baseline: Baseline): number | undefined {
  const ruleBaseline = baseline.rules[diagnostic.code];

  return ruleBaseline?.[diagnostic.filename];
}

function checkDiagnostic(
  currentCount: number | null,
  baselineCount: number | undefined,
): FailureCheck | null {
  if (baselineCount === undefined) {
    return { reason: "not present in lint baseline" };
  }

  if (currentCount === null) {
    return { reason: "could not read current count from diagnostic", baselineCount };
  }

  return currentCount > baselineCount ? { reason: "exceeds lint baseline", baselineCount } : null;
}

function classifyDiagnostic(diagnostic: Diagnostic, baseline: Baseline): Failure | null {
  const baselineCount = getBaselineCount(diagnostic, baseline);
  const currentCount = getCurrentCount(diagnostic);
  const failure = checkDiagnostic(currentCount, baselineCount);

  return failure
    ? createFailure(diagnostic, currentCount, failure.reason, failure.baselineCount)
    : null;
}

function classifyDiagnostics(diagnostics: Diagnostic[], baseline: Baseline): Failure[] {
  return diagnostics.flatMap((diagnostic) => {
    const failure = classifyDiagnostic(diagnostic, baseline);
    return failure ? [failure] : [];
  });
}

const baseline = await readBaseline();
const result = await runOxlint(process.argv.slice(2));
const oxlintOutput = parseOxlintOutput(result.stdout, result.stderr, result.exitCode);
const diagnostics = oxlintOutput.diagnostics ?? [];
const failures = classifyDiagnostics(diagnostics, baseline);

if (failures.length > 0) {
  console.error(`[lint:size] Found ${failures.length} new or regressed size lint diagnostic(s):\n`);
  console.error(failures.map(formatDiagnostic).join("\n\n"));
  process.exit(1);
}

const baselinedCount = diagnostics.length;
const fileCount = oxlintOutput.number_of_files ?? "unknown";
const ruleCount = oxlintOutput.number_of_rules ?? "unknown";
console.log(
  `[lint:size] Passed with ${baselinedCount} existing baseline diagnostic(s) allowed. Checked ${fileCount} files with ${ruleCount} rules.`,
);
