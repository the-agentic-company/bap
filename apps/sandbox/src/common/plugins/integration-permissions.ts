/**
 * OpenCode Plugin: Integration Permissions
 *
 * This plugin handles permission control for integration CLI tools:
 * - Resolves managed operations through the canonical integration catalog
 * - Requests user approval for operations that need approval
 * - Requests OAuth authentication for missing tokens via HTTP callback
 */

import {
  getManagedOperationDescriptor,
  parseManagedIntegrationCliCommand,
  parseManagedIntegrationCliCommands,
} from "@bap/integration-policy";
import { loadRuntimeEnv } from "../lib/runtime-env";

const LEGACY_NON_POLICY_CLI_TO_INTEGRATION: Record<string, string> = {
  discord: "discord",
  "agent-browser": "agent-browser",
};

const LEGACY_NON_POLICY_WRITE_OPERATIONS: Record<string, ReadonlySet<string>> = {
  discord: new Set(["send"]),
};

// Environment variable names for integration tokens
const TOKEN_ENV_VARS: Record<string, string> = {
  slack: "SLACK_ACCESS_TOKEN",
  google_gmail: "GMAIL_ACCESS_TOKEN",
  outlook: "OUTLOOK_ACCESS_TOKEN",
  outlook_calendar: "OUTLOOK_CALENDAR_ACCESS_TOKEN",
  google_calendar: "GOOGLE_CALENDAR_ACCESS_TOKEN",
  google_docs: "GOOGLE_DOCS_ACCESS_TOKEN",
  google_sheets: "GOOGLE_SHEETS_ACCESS_TOKEN",
  google_drive: "GOOGLE_DRIVE_ACCESS_TOKEN",
  notion: "NOTION_ACCESS_TOKEN",
  github: "GITHUB_ACCESS_TOKEN",
  airtable: "AIRTABLE_ACCESS_TOKEN",
  hubspot: "HUBSPOT_ACCESS_TOKEN",
  linkedin: "LINKEDIN_ACCOUNT_ID",
  salesforce: "SALESFORCE_ACCESS_TOKEN",
  dynamics: "DYNAMICS_ACCESS_TOKEN",
  discord: "DISCORD_BOT_TOKEN",
};

// Display names for integrations
const INTEGRATION_NAMES: Record<string, string> = {
  slack: "Slack",
  google_gmail: "Gmail",
  outlook: "Outlook Mail",
  outlook_calendar: "Outlook Calendar",
  google_calendar: "Google Calendar",
  google_docs: "Google Docs",
  google_sheets: "Google Sheets",
  google_drive: "Google Drive",
  notion: "Notion",
  github: "GitHub",
  airtable: "Airtable",
  hubspot: "HubSpot",
  linkedin: "LinkedIn",
  salesforce: "Salesforce",
  dynamics: "Microsoft Dynamics 365",
  discord: "Discord",
  "agent-browser": "Agent Browser",
};

const INTERNAL_DISPLAY_ONLY_INTEGRATIONS = new Set(["agent-browser"]);

// Custom integration permissions loaded from env var
let customPermissions: Record<string, { read: string[]; write: string[] }> = {};

function loadCustomPermissions() {
  const raw = process.env.CUSTOM_INTEGRATION_PERMISSIONS;
  if (raw) {
    try {
      customPermissions = JSON.parse(raw);
    } catch {
      console.error("[Plugin] Failed to parse CUSTOM_INTEGRATION_PERMISSIONS");
    }
  }
}

function extractCommandCandidate(command: string): string | null {
  const segments = command
    .split(/&&|\|\||;|\n/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    const firstToken = segment.split(/\s+/, 1)[0];
    if (
      firstToken &&
      (LEGACY_NON_POLICY_CLI_TO_INTEGRATION[firstToken] || firstToken.startsWith("custom-"))
    ) {
      return segment;
    }
  }

  const trimmed = command.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse a Bash command to extract integration and operation
 */
function parseBashCommand(
  command: string,
): { integration: string; operation: string; managed: boolean } | null {
  const managed = parseManagedIntegrationCliCommand(command);
  if (managed) {
    return {
      integration: managed.integrationType,
      operation: managed.operationKey,
      managed: true,
    };
  }

  const trimmed = extractCommandCandidate(command);
  if (!trimmed) {
    return null;
  }
  const parts = trimmed.split(/\s+/);

  const cliName = parts[0];
  let integration = LEGACY_NON_POLICY_CLI_TO_INTEGRATION[cliName];

  // Check for custom integrations (custom-{slug} pattern)
  if (!integration && cliName.startsWith("custom-")) {
    integration = cliName; // Use full name as integration identifier
  }

  if (!integration) {
    return null;
  }

  const operation = parts[1];
  if (!operation) {
    return null;
  }

  return { integration, operation, managed: false };
}

function commandUsesSlackBotRelay(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed.startsWith("slack ")) {
    return false;
  }
  if (!/\bsend\b/.test(trimmed)) {
    return false;
  }
  return /\s--as\s+bot(?:\s|$)/.test(trimmed);
}

/**
 * Check if an operation requires approval (is a write operation)
 */
function isWriteOperation(integration: string, operation: string): boolean {
  try {
    const managed = getManagedOperationDescriptor(
      integration as Parameters<typeof getManagedOperationDescriptor>[0],
      operation,
    );
    if (managed) {
      return managed.accessHint === "write";
    }
  } catch {
    // Non-managed integration; continue through legacy/custom metadata.
  }

  const customPerms = customPermissions[integration];
  if (customPerms) {
    return customPerms.write.includes(operation);
  }

  return LEGACY_NON_POLICY_WRITE_OPERATIONS[integration]?.has(operation) ?? false;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJsonStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
    .join(",")}}`;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function pickOpenCodeRequestId(
  input: Record<string, unknown>,
  output: Record<string, unknown>,
): string | null {
  const candidates = [
    input.id,
    input.callID,
    input.callId,
    input.toolCallID,
    input.toolCallId,
    output.id,
    output.callID,
    output.callId,
    output.toolCallID,
    output.toolCallId,
  ];
  const match = candidates.find(
    (candidate) => typeof candidate === "string" && candidate.length > 0,
  );
  return typeof match === "string" ? match : null;
}

function pickStringField(
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  candidates: string[],
): string | undefined {
  for (const candidate of candidates) {
    const inputValue = input[candidate];
    if (typeof inputValue === "string" && inputValue.length > 0) {
      return inputValue;
    }
    const outputValue = output[candidate];
    if (typeof outputValue === "string" && outputValue.length > 0) {
      return outputValue;
    }
  }
  return undefined;
}

function pickOpenCodeRuntimeTool(
  input: Record<string, unknown>,
  output: Record<string, unknown>,
):
  | {
      sessionId?: string;
      messageId?: string;
      partId?: string;
      callId?: string;
      toolName: string;
      input: Record<string, unknown>;
    }
  | undefined {
  const callId = pickOpenCodeRequestId(input, output);
  const messageId = pickStringField(input, output, ["messageID", "messageId"]);
  const partId = pickStringField(input, output, ["partID", "partId"]);
  if (!callId || !messageId || !partId) {
    return undefined;
  }
  const sessionId = pickStringField(input, output, ["sessionID", "sessionId"]);
  const toolInput =
    output.args && typeof output.args === "object" && !Array.isArray(output.args)
      ? (output.args as Record<string, unknown>)
      : {};
  return {
    sessionId,
    messageId,
    partId,
    callId,
    toolName: typeof input.tool === "string" && input.tool.length > 0 ? input.tool : "bash",
    input: toolInput,
  };
}

export function getCallbackBaseUrls(): string[] {
  const rawCandidates = [
    process.env.E2B_CALLBACK_BASE_URL,
    process.env.APP_URL,
    process.env.VITE_APP_URL,
  ].filter((value): value is string => Boolean(value && value.trim().length > 0));

  const normalized = rawCandidates.map((value) => value.replace(/\/$/, ""));
  const parsedCandidates = normalized.flatMap((url) => {
    try {
      const parsed = new URL(url);
      return [{ url, hostname: parsed.hostname }];
    } catch {
      return [];
    }
  });

  const deduped = new Map<string, { hostname: string }>();
  for (const candidate of parsedCandidates) {
    if (!deduped.has(candidate.url)) {
      deduped.set(candidate.url, { hostname: candidate.hostname });
    }
  }

  const urls = Array.from(deduped.entries()).map(([url, meta]) => ({
    url,
    hostname: meta.hostname,
  }));

  const publicUrls = urls.filter(({ hostname }) => !isLoopbackHost(hostname)).map(({ url }) => url);
  if (publicUrls.length > 0) {
    return publicUrls;
  }

  const loopbackUrls = urls
    .filter(({ hostname }) => isLoopbackHost(hostname))
    .map(({ url }) => url);
  if (loopbackUrls.length > 0) {
    if (process.env.NODE_ENV !== "production") {
      return [...loopbackUrls, "https://localcan.baptistecolle.com"];
    }
    return loopbackUrls;
  }

  if (process.env.NODE_ENV !== "production") {
    return ["https://localcan.baptistecolle.com"];
  }

  return [];
}

/**
 * Request approval from the server
 */
async function requestApproval(params: {
  integration: string;
  operation: string;
  command: string;
  toolInput: unknown;
  openCodeRequestId?: string | null;
  runtimeTool?: ReturnType<typeof pickOpenCodeRuntimeTool>;
}): Promise<{ decision?: "allow" | "deny"; error?: string }> {
  const APPROVAL_POLL_INTERVAL_MS = 1000;
  const serverUrls = getCallbackBaseUrls();
  const runtimeContext = await readRuntimeContext();
  const providerRequestId = params.openCodeRequestId
    ? `plugin-write:${runtimeContext.runtimeId}:${runtimeContext.turnSeq}:opencode:${params.openCodeRequestId}`
    : `plugin-write:${runtimeContext.runtimeId}:${runtimeContext.turnSeq}:${stableHash(
        stableJsonStringify({
          integration: params.integration,
          operation: params.operation,
          command: params.command,
          toolInput: params.toolInput,
        }),
      )}`;

  if (serverUrls.length === 0) {
    const reason = "Missing callback base URL (APP_URL/VITE_APP_URL/E2B_CALLBACK_BASE_URL)";
    console.error(`[Plugin] ${reason}`);
    return { error: reason };
  }

  const attemptCreate = async (
    index: number,
    lastError?: string,
  ): Promise<{
    decision?: "allow" | "deny" | "pending";
    toolUseId?: string;
    expiresAt?: string;
    error?: string;
  }> => {
    if (index >= serverUrls.length) {
      return {
        error:
          lastError ??
          `Approval callback unreachable. Tried: ${serverUrls
            .map((url) => `${url}/api/internal/runtime/interrupts/create`)
            .join(", ")}`,
      };
    }
    const serverUrl = serverUrls[index]!;
    try {
      const response = await fetch(`${serverUrl}/api/internal/runtime/interrupts/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${runtimeContext.callbackToken}`,
        },
        body: JSON.stringify({
          runtimeId: runtimeContext.runtimeId,
          turnSeq: runtimeContext.turnSeq,
          kind: "plugin_write",
          integration: params.integration,
          operation: params.operation,
          command: params.command,
          toolInput: params.toolInput,
          providerRequestId,
          runtimeTool: params.runtimeTool,
        }),
      });

      if (!response.ok) {
        const bodyPreview = (await response.text()).slice(0, 200);
        const errorMessage = `Approval request failed via ${serverUrl}: ${response.status} ${bodyPreview}`;
        console.error(`[Plugin] ${errorMessage}`);
        return attemptCreate(index + 1, errorMessage);
      }

      const result = await response.json();
      return {
        decision:
          result.status === "accepted"
            ? "allow"
            : result.status === "rejected"
              ? "deny"
              : "pending",
        toolUseId: typeof result.interruptId === "string" ? result.interruptId : undefined,
        expiresAt: typeof result.expiresAt === "string" ? result.expiresAt : undefined,
      };
    } catch (error) {
      const errorMessage = `Approval request error via ${serverUrl}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[Plugin] ${errorMessage}`);
      return attemptCreate(index + 1, errorMessage);
    }
  };

  const created = await attemptCreate(0);
  if (created.error) {
    return { error: created.error };
  }
  if (created.decision === "allow" || created.decision === "deny") {
    return { decision: created.decision };
  }
  if (created.decision !== "pending" || !created.toolUseId) {
    return { error: "Approval callback returned an invalid response" };
  }

  const start = Date.now();
  const expiryMs = created.expiresAt ? Date.parse(created.expiresAt) : Number.NaN;
  const pollUntilMs = Number.isFinite(expiryMs)
    ? Math.max(expiryMs + 2_000, start + APPROVAL_POLL_INTERVAL_MS)
    : Number.POSITIVE_INFINITY;

  while (Date.now() <= pollUntilMs) {
    // eslint-disable-next-line no-await-in-loop -- polling by design
    const pollResults = await Promise.all(
      serverUrls.map(async (serverUrl) => {
        try {
          const response = await fetch(`${serverUrl}/api/internal/runtime/interrupts/status`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${runtimeContext.callbackToken}`,
            },
            body: JSON.stringify({
              runtimeId: runtimeContext.runtimeId,
              turnSeq: runtimeContext.turnSeq,
              interruptId: created.toolUseId,
            }),
          });

          if (!response.ok) {
            const bodyPreview = (await response.text()).slice(0, 200);
            console.error(
              `[Plugin] Approval status failed via ${serverUrl}: ${response.status} ${bodyPreview}`,
            );
            return "pending" as const;
          }

          const result = await response.json();
          return result.status === "accepted"
            ? ("allow" as const)
            : result.status === "rejected" ||
                result.status === "expired" ||
                result.status === "cancelled"
              ? ("deny" as const)
              : ("pending" as const);
        } catch (error) {
          console.error(
            `[Plugin] Approval status error via ${serverUrl}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return "pending" as const;
        }
      }),
    );
    const terminalDecision = pollResults.find(
      (decision): decision is "allow" | "deny" => decision === "allow" || decision === "deny",
    );
    if (terminalDecision) {
      return { decision: terminalDecision };
    }
    // eslint-disable-next-line no-await-in-loop -- polling by design
    await new Promise((resolve) => setTimeout(resolve, APPROVAL_POLL_INTERVAL_MS));
  }

  return { error: "Approval timed out while waiting for user decision" };
}

async function requestWorkspacePolicyDecision(params: {
  integration: string;
  operation: string;
}): Promise<{
  decision?: "auto_approved" | "requires_approval" | "denied";
  source?: string;
  error?: string;
}> {
  const serverUrls = getCallbackBaseUrls();
  const runtimeContext = await readRuntimeContext();
  let lastError = "Workspace policy callback is unavailable";

  for (const serverUrl of serverUrls) {
    try {
      // eslint-disable-next-line no-await-in-loop -- callback URL failover is sequential
      const response = await fetch(`${serverUrl}/api/internal/runtime/interrupts/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${runtimeContext.callbackToken}`,
        },
        body: JSON.stringify({
          kind: "policy_check",
          runtimeId: runtimeContext.runtimeId,
          turnSeq: runtimeContext.turnSeq,
          integration: params.integration,
          operation: params.operation,
        }),
      });
      if (!response.ok) {
        // eslint-disable-next-line no-await-in-loop -- include the current callback failure
        const bodyPreview = (await response.text()).slice(0, 200);
        lastError = `${response.status} ${bodyPreview}`;
        continue;
      }

      // eslint-disable-next-line no-await-in-loop -- this is the successful failover response
      const result = (await response.json()) as {
        decision?: "auto_approved" | "requires_approval" | "denied";
        source?: string;
      };
      if (
        result.decision !== "auto_approved" &&
        result.decision !== "requires_approval" &&
        result.decision !== "denied"
      ) {
        return { error: "Workspace policy callback returned an invalid decision" };
      }
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return { error: lastError };
}

/**
 * Request authentication from the server
 */
async function requestAuth(params: {
  integration: string;
  reason: string;
}): Promise<{ success: boolean; tokens?: Record<string, string>; error?: string }> {
  const AUTH_POLL_INTERVAL_MS = 1000;
  const serverUrls = getCallbackBaseUrls();
  const runtimeContext = await readRuntimeContext();

  if (serverUrls.length === 0) {
    const reason = "Missing callback base URL (APP_URL/VITE_APP_URL/E2B_CALLBACK_BASE_URL)";
    console.error(`[Plugin] ${reason}`);
    return { success: false, error: reason };
  }

  const attemptCreate = async (
    index: number,
    lastError?: string,
  ): Promise<{ interruptId?: string; status?: string; expiresAt?: string; error?: string }> => {
    if (index >= serverUrls.length) {
      return {
        error:
          lastError ??
          `Auth callback unreachable. Tried: ${serverUrls
            .map((url) => `${url}/api/internal/runtime/interrupts/create`)
            .join(", ")}`,
      };
    }
    const serverUrl = serverUrls[index]!;
    try {
      const response = await fetch(`${serverUrl}/api/internal/runtime/interrupts/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${runtimeContext.callbackToken}`,
        },
        body: JSON.stringify({
          runtimeId: runtimeContext.runtimeId,
          turnSeq: runtimeContext.turnSeq,
          kind: "auth",
          integration: params.integration,
          reason: params.reason,
        }),
      });

      if (!response.ok) {
        const bodyPreview = (await response.text()).slice(0, 200);
        const errorMessage = `Auth request failed via ${serverUrl}: ${response.status} ${bodyPreview}`;
        console.error(`[Plugin] ${errorMessage}`);
        return attemptCreate(index + 1, errorMessage);
      }

      const result = await response.json();
      return {
        interruptId: typeof result.interruptId === "string" ? result.interruptId : undefined,
        status: typeof result.status === "string" ? result.status : undefined,
        expiresAt: typeof result.expiresAt === "string" ? result.expiresAt : undefined,
      };
    } catch (error) {
      const errorMessage = `Auth request error via ${serverUrl}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(`[Plugin] ${errorMessage}`);
      return attemptCreate(index + 1, errorMessage);
    }
  };

  const created = await attemptCreate(0);
  if (created.error) {
    return { success: false, error: created.error };
  }
  if (created.status === "accepted") {
    return { success: true };
  }
  if (!created.interruptId) {
    return { success: false, error: "Auth callback returned an invalid response" };
  }

  const start = Date.now();
  const expiryMs = created.expiresAt ? Date.parse(created.expiresAt) : Number.NaN;
  const pollUntilMs = Number.isFinite(expiryMs)
    ? Math.max(expiryMs + 2_000, start + AUTH_POLL_INTERVAL_MS)
    : Number.POSITIVE_INFINITY;

  while (Date.now() <= pollUntilMs) {
    // eslint-disable-next-line no-await-in-loop -- polling by design
    const pollResults = await Promise.all(
      serverUrls.map(async (serverUrl) => {
        try {
          const response = await fetch(`${serverUrl}/api/internal/runtime/interrupts/status`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${runtimeContext.callbackToken}`,
            },
            body: JSON.stringify({
              runtimeId: runtimeContext.runtimeId,
              turnSeq: runtimeContext.turnSeq,
              interruptId: created.interruptId,
            }),
          });

          if (!response.ok) {
            const bodyPreview = (await response.text()).slice(0, 200);
            console.error(
              `[Plugin] Auth status failed via ${serverUrl}: ${response.status} ${bodyPreview}`,
            );
            return { status: "pending" as const };
          }

          const result = await response.json();
          return {
            status: result.status as string,
            tokens:
              typeof result.resolutionPayload === "object" && result.resolutionPayload
                ? (result.resolutionPayload.tokens as Record<string, string> | undefined)
                : undefined,
          };
        } catch (error) {
          console.error(
            `[Plugin] Auth status error via ${serverUrl}: ${error instanceof Error ? error.message : String(error)}`,
          );
          return { status: "pending" as const };
        }
      }),
    );
    const accepted = pollResults.find((entry) => entry.status === "accepted");
    if (accepted) {
      return { success: true, tokens: accepted.tokens };
    }
    const rejected = pollResults.find(
      (entry) =>
        entry.status === "rejected" || entry.status === "expired" || entry.status === "cancelled",
    );
    if (rejected) {
      return { success: false, error: `Auth request ${rejected.status}` };
    }
    // eslint-disable-next-line no-await-in-loop -- polling by design
    await new Promise((resolve) => setTimeout(resolve, AUTH_POLL_INTERVAL_MS));
  }

  return { success: false, error: "Auth timed out while waiting for completion" };
}

/**
 * OpenCode Plugin Export
 */
export const IntegrationPermissionsPlugin = async () => {
  loadCustomPermissions();
  return {
    "tool.execute.before": async (
      input: { tool: string } & Record<string, unknown>,
      output: { args: Record<string, unknown> } & Record<string, unknown>,
    ) => {
      loadRuntimeEnv();

      // Only process Bash commands
      if (input.tool !== "bash" && input.tool !== "Bash") {
        return;
      }

      const command = (output.args.command as string) || "";
      const managedCommands = parseManagedIntegrationCliCommands(command);
      if (managedCommands.length > 1) {
        throw new Error(
          "WORKSPACE_POLICY_COMPOUND_COMMAND_DENIED: run one managed integration operation per tool call",
        );
      }
      const parsed = parseBashCommand(command);

      // Not an integration command, allow it
      if (!parsed) {
        return;
      }

      const { integration, operation } = parsed;
      const allowedRaw = process.env.ALLOWED_INTEGRATIONS || "";
      const allowedList = allowedRaw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

      if (allowedList.length > 0 && !allowedList.includes(integration)) {
        throw new Error(`Integration "${integration}" is not allowed for this workflow`);
      }

      console.log(`[Plugin] Detected integration command: ${integration} ${operation}`);

      if (INTERNAL_DISPLAY_ONLY_INTEGRATIONS.has(integration)) {
        console.log(`[Plugin] ${integration} is display-only, skipping auth and approval checks`);
        return;
      }

      let policyRequiresApproval = false;
      if (parsed.managed) {
        const policy = await requestWorkspacePolicyDecision({ integration, operation });
        if (policy.error) {
          throw new Error(`Workspace policy check failed: ${policy.error}`);
        }
        if (policy.decision === "denied") {
          throw new Error(
            `WORKSPACE_POLICY_DENIED: ${integration}.${operation} is denied by Workspace policy`,
          );
        }
        policyRequiresApproval = policy.decision === "requires_approval";
        console.log(
          `[Plugin] Workspace policy decision for ${integration} ${operation}: ${policy.decision} (${policy.source ?? "unknown"})`,
        );
      }

      // Check if integration token is available
      const tokenEnvVar = TOKEN_ENV_VARS[integration];
      // For custom integrations, check {SLUG}_ACCESS_TOKEN or {SLUG}_API_KEY
      let hasToken = tokenEnvVar ? !!process.env[tokenEnvVar] : false;
      if (!hasToken && integration.startsWith("custom-")) {
        const slug = integration.replace("custom-", "").toUpperCase().replace(/-/g, "_");
        hasToken = !!(process.env[`${slug}_ACCESS_TOKEN`] || process.env[`${slug}_API_KEY`]);
      }
      if (hasToken && integration === "dynamics" && !process.env.DYNAMICS_INSTANCE_URL) {
        hasToken = false;
      }

      // slack send --as bot can use relay without a Slack user token
      if (
        !hasToken &&
        integration === "slack" &&
        operation === "send" &&
        commandUsesSlackBotRelay(command) &&
        !!process.env.SLACK_BOT_RELAY_SECRET &&
        !!(process.env.SLACK_BOT_RELAY_URL || process.env.APP_URL)
      ) {
        hasToken = true;
        console.log("[Plugin] Slack bot relay mode detected, skipping Slack user auth");
      }

      if (!hasToken) {
        console.log(`[Plugin] No token for ${integration}, requesting auth...`);

        const authResult = await requestAuth({
          integration,
          reason: `${INTEGRATION_NAMES[integration] || integration} authentication required`,
        });

        if (authResult.error) {
          throw new Error(`Authentication callback failed: ${authResult.error}`);
        }

        if (!authResult.success) {
          throw new Error(
            `Authentication not completed for ${INTEGRATION_NAMES[integration] || integration}`,
          );
        }

        // Inject received tokens into environment
        if (authResult.tokens) {
          for (const [key, value] of Object.entries(authResult.tokens)) {
            if (typeof value === "string") {
              process.env[key] = value;
              console.log(`[Plugin] Loaded token for ${key}`);
            }
          }
        }
      }

      const legacyRequiresApproval = !parsed.managed && isWriteOperation(integration, operation);
      if (legacyRequiresApproval) {
        console.log(`[Plugin] Operation requires approval, requesting approval...`);

        const decision = await requestApproval({
          integration,
          operation,
          command,
          toolInput: output.args,
          openCodeRequestId: pickOpenCodeRequestId(input, output),
          runtimeTool: pickOpenCodeRuntimeTool(input, output),
        });

        if (decision.error) {
          throw new Error(`Approval check failed: ${decision.error}`);
        }

        if (decision.decision === "deny") {
          throw new Error("User denied this action");
        }

        console.log(`[Plugin] Approval granted for ${integration} ${operation}`);
      } else if (policyRequiresApproval) {
        console.log(
          `[Plugin] Operation approval will be enforced by the integration entrypoint: ${integration} ${operation}`,
        );
      } else {
        console.log(`[Plugin] Operation auto-approved: ${integration} ${operation}`);
      }
    },
  };
};

// Default export for OpenCode plugin loader
export default IntegrationPermissionsPlugin;
import { readRuntimeContext } from "../lib/runtime-context";
