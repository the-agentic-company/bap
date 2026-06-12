type JsonRecord = Record<string, unknown>;

type Args = {
  generationId: string;
  traceId?: string;
  logsUrl: string;
  tracesUrl: string;
  metricsUrl: string;
  requireClientObservation: boolean;
};

const REQUIRED_GENERATION_EVENTS = new Set([
  "cmdclaw.generation.start_rpc",
  "cmdclaw.generation.subscribe_rpc",
  "cmdclaw.generation.terminal",
]);

function readArgs(argv: string[]): Args {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(`Usage:
  bun run observability:validate-generation -- --generation-id gen_...

Options:
  --generation-id <id>   Generation id to validate. Defaults to GENERATION_ID.
  --trace-id <id>        Trace id to validate. Defaults to TRACE_ID or log discovery.
  --logs-url <url>       VictoriaLogs base URL.
  --traces-url <url>     VictoriaTraces base URL.
  --metrics-url <url>    VictoriaMetrics base URL.
  --require-client-observation
                         Require a browser client_observation row.`);
    process.exit(0);
  }

  const values = new Map<string, string>();
  const booleans = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    if (key === "require-client-observation") {
      booleans.add(key);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    values.set(key, next);
    index += 1;
  }

  const generationId = values.get("generation-id") ?? process.env.GENERATION_ID;
  if (!generationId) {
    throw new Error("Pass --generation-id or set GENERATION_ID");
  }

  return {
    generationId,
    traceId: values.get("trace-id") ?? process.env.TRACE_ID,
    logsUrl:
      values.get("logs-url") ?? process.env.APP_VICTORIA_LOGS_URL ?? "http://127.0.0.1:9428",
    tracesUrl:
      values.get("traces-url") ??
      process.env.APP_VICTORIA_TRACES_URL ??
      "http://127.0.0.1:10428",
    metricsUrl:
      values.get("metrics-url") ??
      process.env.APP_VICTORIA_METRICS_URL ??
      "http://127.0.0.1:8428",
    requireClientObservation: booleans.has("require-client-observation"),
  };
}

function asRecords(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is JsonRecord => typeof item === "object" && item !== null);
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const record = value as JsonRecord;
  for (const key of ["data", "hits", "result"]) {
    const nested = asRecords(record[key]);
    if (nested.length > 0) {
      return nested;
    }
  }
  return [record];
}

function getStringField(row: JsonRecord, field: string): string | undefined {
  const value = row[field];
  return typeof value === "string" ? value : undefined;
}

function findTraceId(rows: JsonRecord[]): string | undefined {
  for (const row of rows) {
    const traceId =
      getStringField(row, "trace_id") ??
      getStringField(row, "cmdclaw.trace.id") ??
      getStringField(row, "cmdclaw_trace_id");
    if (traceId) {
      return traceId;
    }
  }
  return undefined;
}

async function queryJson(url: URL): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url.toString()} returned ${response.status}`);
  }
  return await response.json();
}

async function queryNdjson(url: URL): Promise<JsonRecord[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url.toString()} returned ${response.status}`);
  }

  const text = await response.text();
  if (!text.trim()) {
    return [];
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parsed = JSON.parse(line) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`VictoriaLogs row ${index + 1} was not a JSON object`);
      }
      return parsed as JsonRecord;
    });
}

async function queryLogs(baseUrl: string, query: string): Promise<JsonRecord[]> {
  const url = new URL("/select/logsql/query", baseUrl);
  url.searchParams.set("query", query);
  url.searchParams.set("limit", "200");
  return queryNdjson(url);
}

async function queryMetric(baseUrl: string, query: string): Promise<JsonRecord[]> {
  const url = new URL("/api/v1/query", baseUrl);
  url.searchParams.set("query", query);
  return asRecords(await queryJson(url));
}

async function validate(args: Args): Promise<void> {
  const generationRows = await queryLogs(
    args.logsUrl,
    `cmdclaw.generation.id:${args.generationId}`,
  );
  const eventNames = new Set(
    generationRows
      .map(
        (row) =>
          getStringField(row, "cmdclaw.event.name") ?? getStringField(row, "cmdclaw_event_name"),
      )
      .filter((value): value is string => typeof value === "string"),
  );

  for (const eventName of REQUIRED_GENERATION_EVENTS) {
    if (!eventNames.has(eventName)) {
      throw new Error(`Missing ${eventName} for Generation ${args.generationId}`);
    }
  }

  const clientObservationRows = generationRows.filter(
    (row) => getStringField(row, "event.kind") === "client_observation",
  ).length;
  if (args.requireClientObservation && clientObservationRows === 0) {
    throw new Error(`Missing client_observation row for Generation ${args.generationId}`);
  }

  const traceId = args.traceId ?? findTraceId(generationRows);
  if (!traceId) {
    throw new Error(`Could not resolve trace id for Generation ${args.generationId}`);
  }

  const traceRows = await queryLogs(args.logsUrl, `trace_id:${traceId}`);
  if (traceRows.length === 0) {
    throw new Error(`No VictoriaLogs rows found for trace ${traceId}`);
  }

  const traceUrl = new URL(`/select/jaeger/api/traces/${traceId}`, args.tracesUrl);
  const tracePayload = await queryJson(traceUrl);
  if (asRecords(tracePayload).length === 0) {
    throw new Error(`No VictoriaTraces payload found for trace ${traceId}`);
  }

  const metricRows = await queryMetric(
    args.metricsUrl,
    "sum by (outcome, model_provider, sandbox_provider, failure_phase, normalized_error_code) (cmdclaw_generation_terminal_total)",
  );
  if (metricRows.length === 0) {
    throw new Error("Terminal Generation metrics query returned no rows");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        generationId: args.generationId,
        traceId,
        generationLogRows: generationRows.length,
        traceLogRows: traceRows.length,
        clientObservationRows,
        terminalMetricRows: metricRows.length,
      },
      null,
      2,
    ),
  );
}

await validate(readArgs(Bun.argv.slice(2)));
