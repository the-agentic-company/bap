import { createHash } from "node:crypto";
import { parseManagedIntegrationCliCommand } from "@bap/integration-policy";
import { loadRuntimeEnv } from "./runtime-env";
import { readRuntimeContext } from "./runtime-context";

const APPROVAL_POLL_INTERVAL_MS = 1_000;

type RuntimeContext = Awaited<ReturnType<typeof readRuntimeContext>>;

async function postCallback(
  callbackUrl: string,
  callbackToken: string,
  pathname: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${callbackUrl}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${callbackToken}`,
    },
    body: JSON.stringify(body),
  });
}

async function requestAndWaitForApproval(params: {
  callbackUrl: string;
  runtimeContext: RuntimeContext;
  integration: string;
  operation: string;
  command: string;
}): Promise<void> {
  const providerRequestId = `cli-policy:${params.runtimeContext.runtimeId}:${params.runtimeContext.turnSeq}:${createHash(
    "sha256",
  )
    .update(`${params.integration}\0${params.operation}\0${params.command}`)
    .digest("hex")}`;
  const createdResponse = await postCallback(
    params.callbackUrl,
    params.runtimeContext.callbackToken,
    "/api/internal/runtime/interrupts/create",
    {
      kind: "plugin_write",
      runtimeId: params.runtimeContext.runtimeId,
      turnSeq: params.runtimeContext.turnSeq,
      integration: params.integration,
      operation: params.operation,
      command: params.command,
      toolInput: { command: params.command },
      providerRequestId,
      deferApplicationClaim: true,
    },
  );
  if (!createdResponse.ok) {
    throw new Error(`Workspace approval callback failed (${createdResponse.status}).`);
  }
  const created = (await createdResponse.json()) as {
    status?: string;
    interruptId?: string;
    expiresAt?: string;
  };
  if (created.status === "rejected") {
    throw new Error("Workspace policy approval was rejected.");
  }
  if ((created.status !== "pending" && created.status !== "accepted") || !created.interruptId) {
    throw new Error("Workspace approval callback returned an invalid response.");
  }

  const expiryMs = created.expiresAt ? Date.parse(created.expiresAt) : Number.NaN;
  const pollUntilMs = Number.isFinite(expiryMs)
    ? Math.max(expiryMs + 2_000, Date.now() + APPROVAL_POLL_INTERVAL_MS)
    : Number.POSITIVE_INFINITY;
  while (Date.now() <= pollUntilMs) {
    // eslint-disable-next-line no-await-in-loop -- durable approval polling is intentional
    const statusResponse = await postCallback(
      params.callbackUrl,
      params.runtimeContext.callbackToken,
      "/api/internal/runtime/interrupts/status",
      {
        runtimeId: params.runtimeContext.runtimeId,
        turnSeq: params.runtimeContext.turnSeq,
        interruptId: created.interruptId,
      },
    );
    if (statusResponse.ok) {
      // eslint-disable-next-line no-await-in-loop -- response belongs to this poll iteration
      const status = (await statusResponse.json()) as { status?: string };
      if (status.status === "accepted") {
        return;
      }
      if (
        status.status === "already_applied" ||
        status.status === "rejected" ||
        status.status === "expired" ||
        status.status === "cancelled"
      ) {
        throw new Error("Workspace policy approval was rejected.");
      }
    }
    // eslint-disable-next-line no-await-in-loop -- durable approval polling is intentional
    await new Promise((resolve) => setTimeout(resolve, APPROVAL_POLL_INTERVAL_MS));
  }
  throw new Error("Workspace policy approval timed out.");
}

async function getPolicyDecision(params: {
  callbackUrl: string;
  runtimeContext: RuntimeContext;
  integration: string;
  operation: string;
}): Promise<"auto_approved" | "requires_approval" | "denied"> {
  const response = await postCallback(
    params.callbackUrl,
    params.runtimeContext.callbackToken,
    "/api/internal/runtime/interrupts/create",
    {
      kind: "policy_check",
      runtimeId: params.runtimeContext.runtimeId,
      turnSeq: params.runtimeContext.turnSeq,
      integration: params.integration,
      operation: params.operation,
    },
  );
  if (!response.ok) {
    throw new Error(`Workspace policy callback failed (${response.status}).`);
  }
  const result = (await response.json()) as { decision?: string };
  if (
    result.decision !== "auto_approved" &&
    result.decision !== "requires_approval" &&
    result.decision !== "denied"
  ) {
    throw new Error("Workspace policy callback returned an invalid decision.");
  }
  return result.decision;
}

export async function enforceWorkspaceIntegrationPolicyForCli(
  explicitCliName?: string,
): Promise<void> {
  loadRuntimeEnv();
  const command = [explicitCliName, ...process.argv.slice(2)].filter(Boolean).join(" ");
  const parsed = parseManagedIntegrationCliCommand(command);
  if (!parsed) {
    return;
  }

  const runtimeContext = await readRuntimeContext();
  const callbackUrl = (
    process.env.E2B_CALLBACK_BASE_URL ??
    process.env.APP_URL ??
    process.env.VITE_APP_URL
  )?.replace(/\/$/, "");
  if (!callbackUrl) {
    throw new Error("Workspace policy callback is unavailable.");
  }

  const decision = await getPolicyDecision({
    callbackUrl,
    runtimeContext,
    integration: parsed.integrationType,
    operation: parsed.operationKey,
  });
  if (decision === "denied") {
    throw new Error(
      `WORKSPACE_POLICY_DENIED: ${parsed.integrationType}.${parsed.operationKey} is denied by Workspace policy`,
    );
  }
  if (decision === "requires_approval") {
    await requestAndWaitForApproval({
      callbackUrl,
      runtimeContext,
      integration: parsed.integrationType,
      operation: parsed.operationKey,
      command,
    });
    const currentDecision = await getPolicyDecision({
      callbackUrl,
      runtimeContext,
      integration: parsed.integrationType,
      operation: parsed.operationKey,
    });
    if (currentDecision === "denied") {
      throw new Error(
        `WORKSPACE_POLICY_DENIED: ${parsed.integrationType}.${parsed.operationKey} is denied by Workspace policy`,
      );
    }
  }
}
