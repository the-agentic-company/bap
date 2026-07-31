/**
 * Server-side integration CLI permission metadata.
 *
 * Managed Integration Type parsing is owned by @bap/integration-policy so the
 * server and sandbox plugin cannot drift. Coworker and agent-browser remain
 * display-only runtime tools and are deliberately outside Workspace integration
 * operation policy.
 */

import { parseManagedIntegrationCliCommand } from "@bap/integration-policy";

const INTERNAL_DISPLAY_ONLY_TOOLS: Record<
  string,
  {
    integration: "coworker" | "agent-browser";
    displayName: string;
    writeOperations: ReadonlySet<string>;
  }
> = {
  coworker: {
    integration: "coworker",
    displayName: "Coworker",
    writeOperations: new Set(["invoke", "edit", "upload-document", "run", "approve", "builder"]),
  },
  "agent-browser": {
    integration: "agent-browser",
    displayName: "Agent Browser",
    writeOperations: new Set(),
  },
};

export interface ParsedCommand {
  integration: string;
  operation: string;
  integrationName: string;
  isWrite: boolean;
}

function extractInternalCommand(command: string): string[] | null {
  const segments = command
    .split(/&&|\|\||;|\n/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const parts = segments[index]?.split(/\s+/) ?? [];
    if (parts[0] && INTERNAL_DISPLAY_ONLY_TOOLS[parts[0]]) {
      return parts;
    }
  }
  return null;
}

/**
 * Parse an integration CLI command into the metadata used by approval cards and
 * history. Managed operations come from the canonical catalog.
 */
export function parseBashCommand(command: string): ParsedCommand | null {
  const managed = parseManagedIntegrationCliCommand(command);
  if (managed) {
    return {
      integration: managed.integrationType,
      operation: managed.operationKey,
      integrationName: managed.integrationDisplayName,
      isWrite: managed.accessHint === "write",
    };
  }

  const parts = extractInternalCommand(command);
  const internal = parts?.[0] ? INTERNAL_DISPLAY_ONLY_TOOLS[parts[0]] : undefined;
  const operation = parts?.[1];
  if (!internal || !operation) {
    return null;
  }

  return {
    integration: internal.integration,
    operation,
    integrationName: internal.displayName,
    isWrite: internal.writeOperations.has(operation),
  };
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  needsApproval: boolean;
  needsAuth: boolean;
  integration?: string;
  integrationName?: string;
}

/**
 * Compatibility check used by direct-mode projections. Authoritative Workspace
 * policy is evaluated separately; this function retains the existing auth and
 * legacy read/write behavior while consumers migrate.
 */
export function checkToolPermissions(
  toolName: string,
  toolInput: Record<string, unknown>,
  connectedIntegrations: string[],
): PermissionCheckResult {
  if (toolName !== "bash") {
    return { allowed: true, needsApproval: false, needsAuth: false };
  }

  const command = (toolInput.command as string) || "";
  const parsed = parseBashCommand(command);
  if (!parsed) {
    return { allowed: true, needsApproval: false, needsAuth: false };
  }

  if (parsed.integration === "coworker" || parsed.integration === "agent-browser") {
    return { allowed: true, needsApproval: false, needsAuth: false };
  }

  if (!connectedIntegrations.includes(parsed.integration)) {
    return {
      allowed: false,
      needsApproval: false,
      needsAuth: true,
      integration: parsed.integration,
      integrationName: parsed.integrationName,
      reason: `${parsed.integrationName} authentication required`,
    };
  }

  if (parsed.isWrite) {
    return {
      allowed: false,
      needsApproval: true,
      needsAuth: false,
      integration: parsed.integration,
      integrationName: parsed.integrationName,
    };
  }

  return { allowed: true, needsApproval: false, needsAuth: false };
}
