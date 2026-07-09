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

type RenderResource = RenderService | RenderPostgres | RenderKeyValue;

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
  { kind: "service", name: "bap-app-edge-staging" },
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

function readCliArg(name: string): string | null {
  const inlinePrefix = `${name}=`;
  for (const [index, arg] of process.argv.entries()) {
    if (arg === name) {
      return process.argv[index + 1] ?? null;
    }

    if (arg.startsWith(inlinePrefix)) {
      return arg.slice(inlinePrefix.length);
    }
  }

  return null;
}

function writeGithubOutput(name: string, value: string): void {
  const line = `${name}=${value}`;
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, `${line}\n`);
  }
  console.log(line);
}

function getTimeoutMs(): number {
  const rawValue = readCliArg("--timeout-ms")?.trim();
  if (!rawValue) {
    return defaultTimeoutMs;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    fail(`Invalid --timeout-ms value: ${rawValue}`);
  }
  return value;
}

function parseRenderResponse(text: string): unknown {
  const trimmed = text.trim();
  return trimmed ? JSON.parse(trimmed) : null;
}

function isRenderApiError(value: unknown): value is RenderApiError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as RenderApiError;
  return typeof record.message === "string" || typeof record.error === "string";
}

function formatRenderRequestError(
  method: string,
  path: string,
  status: number,
  body: unknown,
  fallback: string,
): string {
  const detail = isRenderApiError(body) ? (body.message ?? body.error) : fallback;
  return `Render API ${method} ${path} failed with ${status}: ${detail}`;
}

function buildRenderHeaders(initHeaders: HeadersInit | undefined): HeadersInit {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
    ...(initHeaders ?? {}),
  };
}

async function renderRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const response = await fetch(`${renderApiBaseUrl}${path}`, {
    ...init,
    headers: buildRenderHeaders(init.headers),
  });

  const text = await response.text();
  const body = parseRenderResponse(text);

  if (!response.ok) {
    throw new Error(formatRenderRequestError(method, path, response.status, body, text));
  }

  return body as T;
}

function appendQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getWrappedCandidate(entry: unknown, wrapperKey: string): unknown {
  if (!isObjectRecord(entry)) {
    return null;
  }

  if (wrapperKey in entry) {
    return entry[wrapperKey];
  }

  return entry;
}

function unwrapNamedCandidate<T extends { id: string; name: string }>(
  entry: unknown,
  wrapperKey: string,
): T | null {
  const candidate = getWrappedCandidate(entry, wrapperKey);
  if (!isObjectRecord(candidate)) {
    return null;
  }

  return candidate as T;
}

function expectRenderList(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(`Render API response for "${name}" was not a list`);
  }

  return value;
}

function toNamedMatch<T extends { id: string; name: string }>(
  entry: unknown,
  wrapperKey: string,
  name: string,
): T[] {
  const resource = unwrapNamedCandidate<T>(entry, wrapperKey);
  if (!resource) {
    return [];
  }

  if (resource.name !== name) {
    return [];
  }

  return [resource];
}

function collectNamedMatches<T extends { id: string; name: string }>(
  entries: unknown[],
  wrapperKey: string,
  name: string,
): T[] {
  return entries.flatMap((entry) => toNamedMatch<T>(entry, wrapperKey, name));
}

function assertResourceIdentity(
  resource: { id: string; name: string },
  wrapperKey: string,
  name: string,
): void {
  if (!resource.id) {
    fail(`Render ${wrapperKey} resource "${name}" did not include an id`);
  }

  if (!resource.name) {
    fail(`Render ${wrapperKey} resource "${name}" did not include a name`);
  }
}

function pickSingleNamedMatch<T extends { id: string; name: string }>(
  matches: T[],
  wrapperKey: string,
  name: string,
): T | null {
  if (matches.length === 0) {
    return null;
  }

  if (matches.length > 1) {
    fail(`Multiple Render ${wrapperKey} resources found with name "${name}"`);
  }

  const resource = matches[0];
  assertResourceIdentity(resource, wrapperKey, name);
  return resource;
}

function findNamed<T extends { id: string; name: string }>(
  value: unknown,
  wrapperKey: string,
  name: string,
): T | null {
  const entries = expectRenderList(value, name);
  const matches = collectNamedMatches<T>(entries, wrapperKey, name);
  return pickSingleNamedMatch(matches, wrapperKey, name);
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

async function resolveNamedResource<T extends { id: string; name: string }>(
  resource: Resource,
  wrapperKey: string,
  path: string,
  label: string,
): Promise<string | null> {
  const params = new URLSearchParams({ limit: "100" });
  params.append("name", resource.name);

  const found = unwrapFound(
    resource,
    wrapperKey,
    findNamed<T>(await renderRequest(appendQuery(path, params)), wrapperKey, resource.name),
  );
  if (!found) {
    return null;
  }

  console.log(`[render-staging-lifecycle] Resolved ${label} "${found.name}" to ${found.id}`);
  return found.id;
}

async function resolveService(resource: Resource): Promise<string | null> {
  return resolveNamedResource<RenderService>(resource, "service", "/services", "service");
}

async function resolvePostgres(resource: Resource): Promise<string | null> {
  return resolveNamedResource<RenderPostgres>(resource, "postgres", "/postgres", "Postgres");
}

async function resolveKeyValue(resource: Resource): Promise<string | null> {
  return resolveNamedResource<RenderKeyValue>(resource, "keyValue", "/key-value", "Key Value");
}

const resourceResolvers = {
  service: resolveService,
  postgres: resolvePostgres,
  "key-value": resolveKeyValue,
} satisfies Record<ResourceKind, (resource: Resource) => Promise<string | null>>;

async function resolveResource(resource: Resource): Promise<string | null> {
  return resourceResolvers[resource.kind](resource);
}

async function getResource(resource: Resource, id: string): Promise<RenderResource> {
  if (resource.kind === "service") {
    return renderRequest<RenderService>(`/services/${id}`);
  }

  if (resource.kind === "postgres") {
    return renderRequest<RenderPostgres>(`/postgres/${id}`);
  }

  return renderRequest<RenderKeyValue>(`/key-value/${id}`);
}

function describedValue(value: string | undefined): string {
  return value ?? "unknown";
}

function describeKeyValueState(value: RenderResource): string {
  return describedValue((value as RenderKeyValue).status);
}

function describeSuspendedState(value: RenderResource): string {
  const suspended = (value as RenderService | RenderPostgres).suspended;
  return describedValue(suspended ?? (value as RenderPostgres).status);
}

const stateDescriptors = {
  service: describeSuspendedState,
  postgres: describeSuspendedState,
  "key-value": describeKeyValueState,
} satisfies Record<ResourceKind, (value: RenderResource) => string>;

function describeState(resource: Resource, value: RenderResource): string {
  return stateDescriptors[resource.kind](value);
}

function isKeyValueInTargetState(command: Command, value: RenderKeyValue): boolean {
  if (command === "resume") {
    return value.status === "available";
  }
  return value.status === "suspended";
}

function isPostgresInTargetState(command: Command, value: RenderPostgres): boolean {
  if (command === "resume") {
    return value.suspended === "not_suspended" && value.status === "available";
  }
  return value.suspended === "suspended";
}

function isServiceInTargetState(command: Command, value: RenderService): boolean {
  if (command === "resume") {
    return value.suspended === "not_suspended";
  }
  return value.suspended === "suspended";
}

function isInTargetState(
  command: Command,
  resource: Resource,
  value: RenderService | RenderPostgres | RenderKeyValue,
): boolean {
  if (resource.kind === "key-value") {
    return isKeyValueInTargetState(command, value as RenderKeyValue);
  }

  if (resource.kind === "postgres") {
    return isPostgresInTargetState(command, value as RenderPostgres);
  }

  return isServiceInTargetState(command, value as RenderService);
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

function isRenderResumeNotUserSuspendedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Render API POST ") &&
    message.includes(" failed with 400: ") &&
    message.toLowerCase().includes("only services suspended by a user can be resumed")
  );
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

async function postLifecycle(command: Command, resource: Resource, id: string): Promise<void> {
  await renderRequest(lifecyclePath(resource, id, command), { method: "POST" });
}

async function handleLifecyclePostError(
  command: Command,
  resource: Resource,
  id: string,
  error: unknown,
): Promise<boolean> {
  if (!shouldHandleResumePostError(command, error)) {
    return false;
  }

  return handleResumePostError(resource, id);
}

function shouldHandleResumePostError(command: Command, error: unknown): boolean {
  if (command !== "resume") {
    return false;
  }

  return isRenderResumeNotUserSuspendedError(error);
}

async function handleResumePostError(resource: Resource, id: string): Promise<boolean> {
  const latest = await getResource(resource, id);
  if (isInTargetState("resume", resource, latest)) {
    console.log(
      `[render-staging-lifecycle] ${resource.name} already ${describeState(resource, latest)}`,
    );
    return true;
  }

  if (!resource.optional) {
    return false;
  }

  console.log(
    `[render-staging-lifecycle] ${resource.name} cannot be resumed by Render API from ${describeState(
      resource,
      latest,
    )}; skipping optional resource`,
  );
  return true;
}

async function isAlreadyInTargetState(
  command: Command,
  resource: Resource,
  id: string,
): Promise<boolean> {
  const current = await getResource(resource, id);
  if (!isInTargetState(command, resource, current)) {
    return false;
  }

  console.log(
    `[render-staging-lifecycle] ${resource.name} already ${describeState(resource, current)}`,
  );
  return true;
}

async function postLifecycleOrRecover(
  command: Command,
  resource: Resource,
  id: string,
): Promise<void> {
  try {
    await postLifecycle(command, resource, id);
  } catch (error) {
    if (await handleLifecyclePostError(command, resource, id, error)) {
      return;
    }
    throw error;
  }
}

async function applyLifecycle(command: Command, resource: Resource): Promise<void> {
  const id = await resolveResource(resource);
  if (!id) {
    return;
  }

  if (await isAlreadyInTargetState(command, resource, id)) {
    return;
  }

  console.log(`[render-staging-lifecycle] ${command} ${resource.kind} ${resource.name}`);
  await postLifecycleOrRecover(command, resource, id);
  await waitForState(command, resource, id);
}

function isCommand(value: string | undefined): value is Command {
  return value === "resume" || value === "suspend";
}

function readCommand(): Command {
  const command = process.argv[2];
  if (!isCommand(command)) {
    fail("Usage: bun scripts/release/render-staging-lifecycle.ts <resume|suspend>");
  }

  return command;
}

function resourcesFor(command: Command): Resource[] {
  if (command === "resume") {
    return stagingResources;
  }

  return [...stagingResources].reverse();
}

async function main(): Promise<void> {
  const command = readCommand();
  const resources = resourcesFor(command);
  for (const resource of resources) {
    await applyLifecycle(command, resource);
  }

  writeGithubOutput("staging_lifecycle", command);
}

if (import.meta.main) {
  void main();
}
