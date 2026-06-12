import { appendFileSync } from "node:fs";

type Command = "resume" | "suspend";
type ResourceKind = "service" | "postgres" | "key-value";

type RenderApiError = {
  message?: string;
  error?: string;
};

type RenderService = {
  id: string;
  name: string;
  suspended?: "suspended" | "not_suspended" | string;
};

type RenderPostgres = {
  id: string;
  name: string;
  suspended?: "suspended" | "not_suspended" | string;
  status?: string;
};

type RenderKeyValue = {
  id: string;
  name: string;
  status?: string;
};

type Resource = {
  kind: ResourceKind;
  name: string;
  optional?: boolean;
};

const renderApiBaseUrl = "https://api.render.com/v1";
const pollMs = 15_000;
const defaultTimeoutMs = 20 * 60 * 1000;

const stagingResources: Resource[] = [
  { kind: "postgres", name: "bap-postgres-staging" },
  { kind: "key-value", name: "bap-redis-staging" },
  { kind: "service", name: "bap-s3-staging" },
  { kind: "service", name: "bap-tailscale-staging" },
  { kind: "service", name: "bap-postgres-tailscale-staging" },
  { kind: "service", name: "bap-zero-cache-staging", optional: true },
  { kind: "service", name: "bap-caddy-staging" },
  { kind: "service", name: "bap-caddy-tailscale-staging" },
  { kind: "service", name: "bap-victoria-metrics-staging" },
  { kind: "service", name: "bap-victoria-logs-staging" },
  { kind: "service", name: "bap-victoria-traces-staging" },
  { kind: "service", name: "bap-vector-staging" },
  { kind: "service", name: "bap-alertmanager-staging" },
  { kind: "service", name: "bap-vmalert-staging" },
  { kind: "service", name: "bap-grafana-staging" },
  { kind: "service", name: "bap-web-staging" },
  { kind: "service", name: "bap-mcp-staging" },
  { kind: "service", name: "bap-worker-staging" },
];

function fail(message: string): never {
  console.error(`[render-staging-lifecycle] ${message}`);
  process.exit(1);
}

function getApiKey(): string {
  const apiKey = process.env.RENDER_API_KEY?.trim();
  if (!apiKey) {
    fail("Missing RENDER_API_KEY");
  }
  return apiKey;
}

function readArg(name: string): string | null {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  if (value) {
    return value.slice(prefix.length);
  }

  const index = process.argv.indexOf(name);
  if (index >= 0) {
    return process.argv[index + 1] ?? null;
  }

  return null;
}

function getTimeoutMs(): number {
  const rawValue = readArg("--timeout-ms")?.trim();
  if (!rawValue) {
    return defaultTimeoutMs;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    fail(`Invalid --timeout-ms value: ${rawValue}`);
  }
  return value;
}

function writeOutput(name: string, value: string): void {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, `${name}=${value}\n`);
  }
  console.log(`${name}=${value}`);
}

async function renderRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${renderApiBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  const text = await response.text();
  const body = text.trim() ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = body as RenderApiError | null;
    throw new Error(
      `Render API ${init.method ?? "GET"} ${path} failed with ${response.status}: ${
        error?.message ?? error?.error ?? text
      }`,
    );
  }

  return body as T;
}

function appendQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function findNamed<T extends { id: string; name: string }>(
  value: unknown,
  wrapperKey: string,
  name: string,
): T | null {
  if (!Array.isArray(value)) {
    fail(`Render API response for "${name}" was not a list`);
  }

  const matches = value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const candidate = wrapperKey in record ? record[wrapperKey] : entry;
    if (typeof candidate !== "object" || candidate === null) {
      return [];
    }

    const resource = candidate as T;
    return resource.name === name ? [resource] : [];
  });

  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    fail(`Multiple Render ${wrapperKey} resources found with name "${name}"`);
  }

  const resource = matches[0];
  if (!resource.id || !resource.name) {
    fail(`Render ${wrapperKey} resource "${name}" did not include an id and name`);
  }

  return resource;
}

function unwrapFound<T extends { id: string; name: string }>(
  resource: Resource,
  wrapperKey: string,
  value: T | null,
): T | null {
  if (value) {
    return value;
  }

  const message = `No Render ${wrapperKey} resource found with name "${resource.name}"`;
  if (resource.optional) {
    console.log(`[render-staging-lifecycle] ${message}; skipping optional resource`);
    return null;
  }

  fail(message);
}

async function resolveResource(resource: Resource): Promise<string | null> {
  const params = new URLSearchParams({ limit: "100" });
  params.append("name", resource.name);

  if (resource.kind === "service") {
    const service = unwrapFound(
      resource,
      "service",
      findNamed<RenderService>(
        await renderRequest(appendQuery("/services", params)),
        "service",
        resource.name,
      ),
    );
    if (!service) {
      return null;
    }
    console.log(`[render-staging-lifecycle] Resolved service "${service.name}" to ${service.id}`);
    return service.id;
  }

  if (resource.kind === "postgres") {
    const postgres = unwrapFound(
      resource,
      "postgres",
      findNamed<RenderPostgres>(
        await renderRequest(appendQuery("/postgres", params)),
        "postgres",
        resource.name,
      ),
    );
    if (!postgres) {
      return null;
    }
    console.log(
      `[render-staging-lifecycle] Resolved Postgres "${postgres.name}" to ${postgres.id}`,
    );
    return postgres.id;
  }

  const keyValue = unwrapFound(
    resource,
    "keyValue",
    findNamed<RenderKeyValue>(
      await renderRequest(appendQuery("/key-value", params)),
      "keyValue",
      resource.name,
    ),
  );
  if (!keyValue) {
    return null;
  }
  console.log(`[render-staging-lifecycle] Resolved Key Value "${keyValue.name}" to ${keyValue.id}`);
  return keyValue.id;
}

async function getResource(
  resource: Resource,
  id: string,
): Promise<RenderService | RenderPostgres | RenderKeyValue> {
  if (resource.kind === "service") {
    return renderRequest<RenderService>(`/services/${id}`);
  }

  if (resource.kind === "postgres") {
    return renderRequest<RenderPostgres>(`/postgres/${id}`);
  }

  return renderRequest<RenderKeyValue>(`/key-value/${id}`);
}

function describeState(
  resource: Resource,
  value: RenderService | RenderPostgres | RenderKeyValue,
): string {
  if (resource.kind === "key-value") {
    return (value as RenderKeyValue).status ?? "unknown";
  }

  const suspended = (value as RenderService | RenderPostgres).suspended;
  return suspended ?? (value as RenderPostgres).status ?? "unknown";
}

function isInTargetState(
  command: Command,
  resource: Resource,
  value: RenderService | RenderPostgres | RenderKeyValue,
): boolean {
  if (resource.kind === "key-value") {
    const status = (value as RenderKeyValue).status;
    return command === "resume" ? status === "available" : status === "suspended";
  }

  if (resource.kind === "postgres") {
    const postgres = value as RenderPostgres;
    if (command === "resume") {
      return postgres.suspended === "not_suspended" && postgres.status === "available";
    }
    return postgres.suspended === "suspended";
  }

  const suspended = (value as RenderService | RenderPostgres).suspended;
  return command === "resume" ? suspended === "not_suspended" : suspended === "suspended";
}

function lifecyclePath(resource: Resource, id: string, command: Command): string {
  if (resource.kind === "service") {
    return `/services/${id}/${command}`;
  }

  if (resource.kind === "postgres") {
    return `/postgres/${id}/${command}`;
  }

  return `/key-value/${id}/${command}`;
}

async function waitForState(command: Command, resource: Resource, id: string): Promise<void> {
  const timeoutMs = getTimeoutMs();
  const startedAt = Date.now();

  while (true) {
    const current = await getResource(resource, id);
    const state = describeState(resource, current);
    console.log(`[render-staging-lifecycle] ${resource.name} state=${state}`);

    if (isInTargetState(command, resource, current)) {
      return;
    }

    if (Date.now() - startedAt > timeoutMs) {
      fail(`Timed out waiting for ${resource.name} to ${command}`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function applyLifecycle(command: Command, resource: Resource): Promise<void> {
  const id = await resolveResource(resource);
  if (!id) {
    return;
  }

  const current = await getResource(resource, id);
  if (isInTargetState(command, resource, current)) {
    console.log(
      `[render-staging-lifecycle] ${resource.name} already ${describeState(resource, current)}`,
    );
    return;
  }

  console.log(`[render-staging-lifecycle] ${command} ${resource.kind} ${resource.name}`);
  await renderRequest(lifecyclePath(resource, id, command), { method: "POST" });
  await waitForState(command, resource, id);
}

async function main(): Promise<void> {
  const command = process.argv[2] as Command | undefined;
  if (command !== "resume" && command !== "suspend") {
    fail("Usage: bun scripts/release/render-staging-lifecycle.ts <resume|suspend>");
  }

  const resources = command === "resume" ? stagingResources : [...stagingResources].reverse();
  for (const resource of resources) {
    await applyLifecycle(command, resource);
  }

  writeOutput("staging_lifecycle", command);
}

if (import.meta.main) {
  void main();
}
