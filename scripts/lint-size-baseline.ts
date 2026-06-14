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

const baselineUrl = new URL("../lint-baselines/size.json", import.meta.url);

function fail(message: string): never {
  console.error(`[lint:size] ${message}`);
  process.exit(1);
}

async function readBaseline(): Promise<Baseline> {
  const baseline = (await Bun.file(baselineUrl).json()) as unknown;

  if (typeof baseline !== "object" || baseline === null || !("rules" in baseline)) {
    fail("Invalid lint baseline: missing rules object.");
  }

  const rules = (baseline as { rules: unknown }).rules;
  if (typeof rules !== "object" || rules === null || Array.isArray(rules)) {
    fail("Invalid lint baseline: rules must be an object.");
  }

  for (const [ruleName, entries] of Object.entries(rules)) {
    if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
      fail(`Invalid lint baseline: ${ruleName} entries must be an object.`);
    }
    for (const [filename, count] of Object.entries(entries)) {
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
        fail(
          `Invalid lint baseline: ${ruleName} entry ${filename} must be a non-negative integer.`,
        );
      }
    }
  }

  return { rules: rules as Record<string, Record<string, number>> };
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

function parseOxlintOutput(stdout: string, stderr: string, exitCode: number): OxlintOutput {
  const trimmed = stdout.trim();
  if (!trimmed) {
    if (exitCode === 0) {
      return { diagnostics: [] };
    }
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
    fail(`Oxlint exited with ${exitCode} and did not produce JSON output.`);
  }

  try {
    return JSON.parse(trimmed) as OxlintOutput;
  } catch (error) {
    if (stdout.trim()) {
      console.error(stdout.trim());
    }
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
    fail(`Could not parse Oxlint JSON output: ${(error as Error).message}`);
  }
}

function getCurrentCount(diagnostic: Diagnostic): number | null {
  if (diagnostic.code === "eslint(max-lines)") {
    const match = diagnostic.message.match(/File has too many lines \((\d+)\)\./);
    return match ? Number(match[1]) : null;
  }

  if (diagnostic.code === "local(max-mocked-modules)") {
    const match = diagnostic.message.match(/This test mocks (\d+) distinct modules/);
    return match ? Number(match[1]) : null;
  }

  return null;
}

function formatDiagnostic(failure: Failure): string {
  const { diagnostic } = failure;
  const span = diagnostic.labels?.[0]?.span;
  const line = span?.line ?? 1;
  const column = span?.column ?? 1;
  const countDetails =
    failure.currentCount === null
      ? ""
      : failure.baselineCount === undefined
        ? ` current=${failure.currentCount}`
        : ` current=${failure.currentCount} baseline=${failure.baselineCount}`;

  return [
    `${diagnostic.filename}:${line}:${column}: ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`,
    `  ${failure.reason}${countDetails}`,
  ].join("\n");
}

function classifyDiagnostics(diagnostics: Diagnostic[], baseline: Baseline): Failure[] {
  const failures: Failure[] = [];

  for (const diagnostic of diagnostics) {
    const ruleBaseline = baseline.rules[diagnostic.code];
    const baselineCount = ruleBaseline?.[diagnostic.filename];
    const currentCount = getCurrentCount(diagnostic);

    if (baselineCount === undefined) {
      failures.push({
        diagnostic,
        currentCount,
        reason: "not present in lint baseline",
      });
      continue;
    }

    if (currentCount === null) {
      failures.push({
        diagnostic,
        currentCount,
        baselineCount,
        reason: "could not read current count from diagnostic",
      });
      continue;
    }

    if (currentCount > baselineCount) {
      failures.push({
        diagnostic,
        currentCount,
        baselineCount,
        reason: "exceeds lint baseline",
      });
    }
  }

  return failures;
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
