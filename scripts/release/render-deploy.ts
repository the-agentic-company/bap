import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

type DeployStatus =
  | "created"
  | "build_in_progress"
  | "update_in_progress"
  | "live"
  | "deactivated"
  | "build_failed"
  | "update_failed"
  | "canceled"
  | string;

type RenderDeploy = {
  id: string;
  status?: DeployStatus;
  commit?: {
    id?: string;
    message?: string;
  };
  createdAt?: string;
  finishedAt?: string;
};

type RenderService = {
  id: string;
  name: string;
  ownerId?: string;
  type?: string;
  dashboardUrl?: string;
};

type RenderServiceEvent = {
  id: string;
  timestamp?: string;
  type?: string;
  details?: Record<string, unknown>;
};

type RenderLogLabel = {
  name: string;
  value: string;
};

type RenderLog = {
  timestamp?: string;
  message?: string;
  labels?: RenderLogLabel[];
};

type RenderLogsResponse = {
  logs?: RenderLog[];
};

type RenderApiError = {
  message?: string;
  error?: string;
};

type Command = "previous-success" | "deploy" | "rollback" | "wait";
type CommandHandler = (serviceId: string) => Promise<void>;
type WaitForDeployOptions = {
  timeoutMs: number;
  pollMs: number;
};

const renderApiBaseUrl = "https://api.render.com/v1";
const successStatuses = new Set(["live"]);
const failedStatuses = new Set(["build_failed", "update_failed", "canceled", "deactivated"]);
const transientRetryDelaysMs = [5_000, 15_000, 30_000];

class RenderRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly method: string,
    public readonly path: string,
  ) {
    super(message);
    this.name = "RenderRequestError";
  }
}

function fail(message: string): never {
  console.error(`[render-deploy] ${message}`);
  process.exit(1);
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

function requireArg(name: string): string {
  const value = readArg(name)?.trim();
  if (!value) {
    fail(`Missing required argument ${name}`);
  }
  return value;
}

function getApiKey(): string {
  const apiKey = process.env.RENDER_API_KEY?.trim();
  if (!apiKey) {
    fail("Missing RENDER_API_KEY");
  }
  return apiKey;
}

function describeUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeCommitId(value: string): string {
  return value.trim().toLowerCase();
}

function shortCommitId(value: string): string {
  return value.trim().slice(0, 12);
}

function commitIdsMatch(actual: string, expected: string): boolean {
  const normalizedActual = normalizeCommitId(actual);
  const normalizedExpected = normalizeCommitId(expected);
  if (!normalizedActual || !normalizedExpected) {
    return false;
  }

  return (
    normalizedActual === normalizedExpected ||
    normalizedActual.startsWith(normalizedExpected) ||
    normalizedExpected.startsWith(normalizedActual)
  );
}

function resolveLocalCommitSubject(commitId: string): string | null {
  try {
    const subject = execFileSync("git", ["show", "-s", "--format=%s", commitId], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return subject || null;
  } catch {
    return null;
  }
}

function formatCommit(commitId: string, subject?: string | null): string {
  const suffix = subject ? ` ${subject}` : "";
  return `${shortCommitId(commitId)}${suffix}`;
}

function formatRenderCommit(deploy: RenderDeploy): string {
  const commitId = deploy.commit?.id?.trim();
  if (!commitId) {
    return "unreported";
  }
  return formatCommit(commitId, deploy.commit?.message);
}

function assertRenderCommitMatchesExpected(deploy: RenderDeploy, expectedCommitId: string): void {
  const actualCommitId = deploy.commit?.id?.trim();
  if (!actualCommitId) {
    fail(
      `Render deploy ${deploy.id} did not report a commit id; expected ${shortCommitId(
        expectedCommitId,
      )}`,
    );
  }

  if (!commitIdsMatch(actualCommitId, expectedCommitId)) {
    fail(
      `Render deploy ${deploy.id} is for ${formatRenderCommit(
        deploy,
      )}, expected ${shortCommitId(expectedCommitId)}`,
    );
  }
}

function formatExpectedCommitSuffix(expectedCommitId?: string): string {
  return expectedCommitId ? ` expected=${shortCommitId(expectedCommitId)}` : "";
}

function readWaitForDeployOptions(): WaitForDeployOptions {
  return {
    timeoutMs: Number(readArg("--timeout-ms") ?? "1800000"),
    pollMs: Number(readArg("--poll-ms") ?? "15000"),
  };
}

function logDeployPoll(
  serviceId: string,
  deployId: string,
  deploy: RenderDeploy,
  status: string,
  expectedCommitId?: string,
): void {
  console.log(
    `[render-deploy] ${serviceId} ${deployId} status=${status} render_commit=${formatRenderCommit(
      deploy,
    )}${formatExpectedCommitSuffix(expectedCommitId)}`,
  );
}

function isTransientRenderError(error: unknown): boolean {
  if (error instanceof RenderRequestError) {
    return error.status >= 500 || error.status === 429;
  }

  return error instanceof TypeError;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function renderRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
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
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = body as RenderApiError | null;
    throw new RenderRequestError(
      `Render API ${method} ${path} failed with ${response.status}: ${
        error?.message ?? error?.error ?? text
      }`,
      response.status,
      method,
      path,
    );
  }

  return body as T;
}

async function renderRequestWithRetry<T>(path: string, init: RequestInit = {}): Promise<T> {
  for (const [index, delayMs] of [...transientRetryDelaysMs, 0].entries()) {
    try {
      return await renderRequest<T>(path, init);
    } catch (error) {
      if (!isTransientRenderError(error) || index === transientRetryDelaysMs.length) {
        throw error;
      }

      console.error(
        `[render-deploy] ${describeUnknownError(error)}; retrying in ${delayMs / 1000}s.`,
      );
      await sleep(delayMs);
    }
  }

  throw new Error("Render request retry loop exited unexpectedly");
}

async function renderFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await renderRequest<T>(path, init);
  } catch (error) {
    fail(describeUnknownError(error));
  }
}

function unwrapDeploy(value: unknown): RenderDeploy {
  if (typeof value !== "object" || value === null) {
    fail("Render API response did not include a deploy object");
  }

  const record = value as Record<string, unknown>;
  const candidate = "deploy" in record ? record.deploy : value;
  if (typeof candidate !== "object" || candidate === null) {
    fail("Render API response did not include a deploy object");
  }

  const deploy = candidate as RenderDeploy;
  if (!deploy.id) {
    fail("Render deploy response did not include an id");
  }
  return deploy;
}

function unwrapDeploys(value: unknown): RenderDeploy[] {
  if (!Array.isArray(value)) {
    fail("Render API deploy list response was not an array");
  }

  return value.map((entry) => unwrapDeploy(entry));
}

function unwrapService(value: unknown): RenderService {
  if (typeof value !== "object" || value === null) {
    fail("Render API response did not include a service object");
  }

  const record = value as Record<string, unknown>;
  const candidate = "service" in record ? record.service : value;
  if (typeof candidate !== "object" || candidate === null) {
    fail("Render API response did not include a service object");
  }

  const service = candidate as RenderService;
  if (!service.id || !service.name) {
    fail("Render service response did not include an id and name");
  }
  return service;
}

function unwrapServices(value: unknown): RenderService[] {
  if (!Array.isArray(value)) {
    fail("Render API service list response was not an array");
  }

  return value.map((entry) => unwrapService(entry));
}

function writeOutput(name: string, value: string): void {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    appendFileSync(githubOutput, `${name}=${value}\n`);
  }
  console.log(`${name}=${value}`);
}

async function resolveServiceIdByName(serviceName: string): Promise<string> {
  const services = unwrapServices(
    await renderFetch(`/services?limit=100&name=${encodeURIComponent(serviceName)}`),
  );
  const matches = services.filter((service) => service.name === serviceName);

  if (matches.length === 0) {
    fail(`No Render service found with name "${serviceName}"`);
  }

  if (matches.length > 1) {
    fail(
      `Multiple Render services found with name "${serviceName}". Use unique service names before deploying.`,
    );
  }

  const service = matches[0];
  console.log(`[render-deploy] Resolved service "${service.name}" to ${service.id}`);
  return service.id;
}

async function resolveServiceId(): Promise<string> {
  const explicitServiceId = readArg("--service-id")?.trim();
  if (explicitServiceId) {
    return explicitServiceId;
  }

  const serviceName = readArg("--service-name")?.trim();
  if (!serviceName) {
    fail("Missing required argument --service-id or --service-name");
  }

  return resolveServiceIdByName(serviceName);
}

async function getDeploy(serviceId: string, deployId: string): Promise<RenderDeploy> {
  return unwrapDeploy(await renderFetch(`/services/${serviceId}/deploys/${deployId}`));
}

async function getService(serviceId: string): Promise<RenderService> {
  return unwrapService(await renderRequest(`/services/${serviceId}`));
}

function groupStart(title: string): void {
  if (process.env.GITHUB_ACTIONS) {
    console.error(`::group::${title}`);
    return;
  }
  console.error(`[render-deploy] ${title}`);
}

function groupEnd(): void {
  if (process.env.GITHUB_ACTIONS) {
    console.error("::endgroup::");
  }
}

function buildDiagnosticsWindow(deploy: RenderDeploy): { startTime: string; endTime: string } {
  const fallbackEnd = new Date();
  const deployStart = deploy.createdAt ? new Date(deploy.createdAt) : fallbackEnd;
  const deployEnd = deploy.finishedAt ? new Date(deploy.finishedAt) : fallbackEnd;
  const startTime = new Date(deployStart.getTime() - 5 * 60 * 1000).toISOString();
  const endTime = new Date(deployEnd.getTime() + 5 * 60 * 1000).toISOString();
  return { startTime, endTime };
}

function appendQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function getLabel(log: RenderLog, labelName: string): string | null {
  return log.labels?.find((label) => label.name === labelName)?.value ?? null;
}

function printLogs(logs: RenderLog[]): void {
  if (logs.length === 0) {
    console.error("[render-deploy] No Render logs returned for this deploy window.");
    return;
  }

  for (const log of logs) {
    const timestamp = log.timestamp ?? "unknown-time";
    const type = getLabel(log, "type") ?? "log";
    const level = getLabel(log, "level");
    const levelSuffix = level ? `/${level}` : "";
    console.error(`${timestamp} [${type}${levelSuffix}] ${log.message ?? ""}`);
  }
}

function sortLogsAscending(logs: RenderLog[]): RenderLog[] {
  return logs.toSorted((left, right) => {
    const leftTime = left.timestamp ? Date.parse(left.timestamp) : 0;
    const rightTime = right.timestamp ? Date.parse(right.timestamp) : 0;
    return leftTime - rightTime;
  });
}

function unwrapServiceEvents(value: unknown): RenderServiceEvent[] {
  if (!Array.isArray(value)) {
    throw new Error("Render API event list response was not an array");
  }

  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }
    const record = entry as Record<string, unknown>;
    const candidate = "event" in record ? record.event : entry;
    if (typeof candidate !== "object" || candidate === null) {
      return [];
    }
    return [candidate as RenderServiceEvent];
  });
}

function eventMentionsDeploy(event: RenderServiceEvent, deployId: string): boolean {
  return formatJson(event.details ?? {}).includes(deployId);
}

async function printDeployDiagnostics(serviceId: string, deploy: RenderDeploy): Promise<void> {
  groupStart("Render deploy diagnostics");
  try {
    const { startTime, endTime } = buildDiagnosticsWindow(deploy);
    let service: RenderService | null = null;

    try {
      service = await getService(serviceId);
    } catch (error) {
      console.error(
        `[render-deploy] Failed to fetch Render service: ${describeUnknownError(error)}`,
      );
    }

    console.error(
      `[render-deploy] service=${service?.name ?? "unknown"} id=${serviceId} deploy=${deploy.id} status=${
        deploy.status ?? "unknown"
      }`,
    );
    if (service?.dashboardUrl) {
      console.error(`[render-deploy] dashboard=${service.dashboardUrl}`);
    }
    console.error(`[render-deploy] diagnostics_window=${startTime}..${endTime}`);

    try {
      await printRecentEvents(serviceId, deploy.id, startTime, endTime);
    } catch (error) {
      console.error(
        `[render-deploy] Failed to fetch Render events: ${describeUnknownError(error)}`,
      );
    }

    try {
      if (service) {
        await printRecentLogs(service, startTime, endTime);
      } else {
        console.error(
          "[render-deploy] Cannot fetch Render logs because service metadata is missing.",
        );
      }
    } catch (error) {
      console.error(`[render-deploy] Failed to fetch Render logs: ${describeUnknownError(error)}`);
    }
  } catch (error) {
    console.error(
      `[render-deploy] Failed to fetch Render diagnostics: ${describeUnknownError(error)}`,
    );
  } finally {
    groupEnd();
  }
}

async function printRecentEvents(
  serviceId: string,
  deployId: string,
  startTime: string,
  endTime: string,
): Promise<void> {
  const params = new URLSearchParams({
    limit: "30",
    startTime,
    endTime,
  });
  const events = unwrapServiceEvents(
    await renderRequest(appendQuery(`/services/${serviceId}/events`, params)),
  );
  const visibleEvents = events.filter(
    (event) =>
      eventMentionsDeploy(event, deployId) ||
      event.type === "server_failed" ||
      event.type === "image_pull_failed",
  );

  console.error("[render-deploy] Recent Render events:");
  if (visibleEvents.length === 0) {
    console.error("[render-deploy] No matching Render events returned for this deploy window.");
    return;
  }

  for (const event of visibleEvents) {
    console.error(
      `${event.timestamp ?? "unknown-time"} [${event.type ?? "unknown-event"}] ${
        event.details ? formatJson(event.details) : "{}"
      }`,
    );
  }
}

async function printRecentLogs(
  service: RenderService,
  startTime: string,
  endTime: string,
): Promise<void> {
  if (!service.ownerId) {
    console.error("[render-deploy] Cannot fetch Render logs because service ownerId is missing.");
    return;
  }

  const baseParams = {
    ownerId: service.ownerId,
    startTime,
    endTime,
    limit: "100",
  };

  const buildParams = (direction: "forward" | "backward"): URLSearchParams => {
    const params = new URLSearchParams({ ...baseParams, direction });
    params.append("resource", service.id);
    params.append("type", "build");
    params.append("type", "app");
    return params;
  };

  const head = await renderRequest<RenderLogsResponse>(
    appendQuery("/logs", buildParams("forward")),
  );
  console.error("[render-deploy] Recent Render logs (oldest first):");
  printLogs(head.logs ?? []);

  const tail = await renderRequest<RenderLogsResponse>(
    appendQuery("/logs", buildParams("backward")),
  );
  console.error("[render-deploy] Recent Render logs (newest first):");
  printLogs(sortLogsAscending(tail.logs ?? []));
}

async function failOnUnexpectedDeployCommit(
  serviceId: string,
  deploy: RenderDeploy,
  expectedCommitId?: string,
): Promise<void> {
  const actualCommitId = deploy.commit?.id;
  if (!expectedCommitId || !actualCommitId || commitIdsMatch(actualCommitId, expectedCommitId)) {
    return;
  }

  await printDeployDiagnostics(serviceId, deploy);
  assertRenderCommitMatchesExpected(deploy, expectedCommitId);
}

async function finishIfDeployTerminal(
  serviceId: string,
  deployId: string,
  deploy: RenderDeploy,
  status: string,
  expectedCommitId?: string,
): Promise<RenderDeploy | null> {
  if (successStatuses.has(status)) {
    if (expectedCommitId) {
      assertRenderCommitMatchesExpected(deploy, expectedCommitId);
    }
    return deploy;
  }

  if (failedStatuses.has(status)) {
    await printDeployDiagnostics(serviceId, deploy);
    fail(`Deploy ${deployId} for service ${serviceId} failed with status ${status}`);
  }

  return null;
}

async function failOnDeployTimeout(
  serviceId: string,
  deployId: string,
  deploy: RenderDeploy,
  startedAt: number,
  timeoutMs: number,
): Promise<void> {
  if (Date.now() - startedAt <= timeoutMs) {
    return;
  }

  await printDeployDiagnostics(serviceId, deploy);
  fail(`Timed out waiting for deploy ${deployId} for service ${serviceId}`);
}

async function waitForDeploy(
  serviceId: string,
  deployId: string,
  expectedCommitId?: string,
): Promise<RenderDeploy> {
  const { timeoutMs, pollMs } = readWaitForDeployOptions();
  const startedAt = Date.now();

  while (true) {
    const deploy = await getDeploy(serviceId, deployId);
    const status = deploy.status ?? "unknown";
    logDeployPoll(serviceId, deployId, deploy, status, expectedCommitId);
    await failOnUnexpectedDeployCommit(serviceId, deploy, expectedCommitId);

    const terminalDeploy = await finishIfDeployTerminal(
      serviceId,
      deployId,
      deploy,
      status,
      expectedCommitId,
    );
    if (terminalDeploy) {
      return terminalDeploy;
    }

    await failOnDeployTimeout(serviceId, deployId, deploy, startedAt, timeoutMs);
    await sleep(pollMs);
  }
}

async function findPreviousSuccessfulDeploy(serviceId: string): Promise<RenderDeploy | null> {
  const deploys = unwrapDeploys(await renderFetch(`/services/${serviceId}/deploys?limit=20`));

  return deploys.find((deploy) => successStatuses.has(deploy.status ?? "")) ?? null;
}

async function createDeploy(
  serviceId: string,
  options: { commitId?: string; imageUrl?: string },
): Promise<RenderDeploy> {
  const { commitId, imageUrl } = options;
  const body: Record<string, string> = { clearCache: "do_not_clear" };
  if (commitId) {
    body.commitId = commitId;
  }
  if (imageUrl) {
    body.imageUrl = imageUrl;
  }

  return unwrapDeploy(
    await renderRequestWithRetry(`/services/${serviceId}/deploys`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

async function updateDockerCommand(serviceId: string, dockerCommand: string): Promise<void> {
  await renderRequestWithRetry(`/services/${serviceId}`, {
    method: "PATCH",
    body: JSON.stringify({
      serviceDetails: {
        envSpecificDetails: {
          dockerCommand,
        },
      },
    }),
  });
}

async function rollbackDeploy(serviceId: string, deployId: string): Promise<RenderDeploy> {
  return unwrapDeploy(
    await renderRequestWithRetry(`/services/${serviceId}/rollback`, {
      method: "POST",
      body: JSON.stringify({ deployId }),
    }),
  );
}

function isCommand(value: string | undefined): value is Command {
  return (
    value === "previous-success" || value === "deploy" || value === "rollback" || value === "wait"
  );
}

function readCommand(): Command {
  const command = process.argv[2];
  if (!isCommand(command)) {
    fail("Usage: bun scripts/release/render-deploy.ts <previous-success|deploy|rollback|wait>");
  }
  return command;
}

async function handlePreviousSuccess(serviceId: string): Promise<void> {
  const deploy = await findPreviousSuccessfulDeploy(serviceId);
  if (!deploy) {
    fail(`No previous successful deploy found for service ${serviceId}`);
  }
  writeOutput("deploy_id", deploy.id);
}

function logDeployRequest(
  serviceId: string,
  input: {
    sourceRef?: string;
    commitId?: string;
    commitSubject?: string | null;
    imageUrl?: string;
  },
): void {
  console.log(
    `[render-deploy] Preparing deploy for ${serviceId}: source_ref=${
      input.sourceRef || "-"
    } commit=${
      input.commitId ? formatCommit(input.commitId, input.commitSubject) : "-"
    } image_url=${input.imageUrl || "-"}`,
  );
}

async function applyDockerCommandOverride(
  serviceId: string,
  dockerCommand?: string,
): Promise<void> {
  if (!dockerCommand) {
    return;
  }
  console.log(`[render-deploy] Updating Docker command for ${serviceId}`);
  await updateDockerCommand(serviceId, dockerCommand);
}

async function handleDeploy(serviceId: string): Promise<void> {
  const commitId = readArg("--commit")?.trim();
  const sourceRef = readArg("--source-ref")?.trim();
  const imageUrl = readArg("--image-url")?.trim();
  const dockerCommand = readArg("--docker-command")?.trim();
  if (!commitId && !imageUrl) {
    fail("Missing required argument --commit or --image-url");
  }

  const commitSubject = commitId ? resolveLocalCommitSubject(commitId) : null;
  logDeployRequest(serviceId, { sourceRef, commitId, commitSubject, imageUrl });
  await applyDockerCommandOverride(serviceId, dockerCommand);

  const deploy = await createDeploy(serviceId, { commitId, imageUrl });
  console.log(
    `[render-deploy] Created deploy ${deploy.id} for ${serviceId}: requested_commit=${
      commitId ? formatCommit(commitId, commitSubject) : "-"
    } render_commit=${formatRenderCommit(deploy)}`,
  );
  await failOnUnexpectedDeployCommit(serviceId, deploy, commitId);
  writeOutput("deploy_id", deploy.id);
  await waitForDeploy(serviceId, deploy.id, commitId);
}

async function handleRollback(serviceId: string): Promise<void> {
  const targetDeployId = requireArg("--deploy-id");
  const deploy = await rollbackDeploy(serviceId, targetDeployId);
  writeOutput("rollback_deploy_id", deploy.id);
  await waitForDeploy(serviceId, deploy.id);
}

async function handleWait(serviceId: string): Promise<void> {
  const deployId = requireArg("--deploy-id");
  await waitForDeploy(serviceId, deployId);
}

const commandHandlers: Record<Command, CommandHandler> = {
  "previous-success": handlePreviousSuccess,
  deploy: handleDeploy,
  rollback: handleRollback,
  wait: handleWait,
};

async function main(): Promise<void> {
  const command = readCommand();
  const serviceId = await resolveServiceId();
  await commandHandlers[command](serviceId);
}

if (import.meta.main) {
  void main();
}
