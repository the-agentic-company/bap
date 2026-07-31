import { ALL_INTEGRATION_TYPES, type DisplayIntegrationType } from "@/lib/integration-icons";

export type WorkspaceMcpServerLike = {
  id?: string;
  namespace: string;
  kind: "mcp";
  name?: string | null;
  endpoint?: string | null;
};

type ExecutorDisplayMetadata = {
  metadataInput: unknown;
  integration?: DisplayIntegrationType;
  source?: WorkspaceMcpServerLike;
  toolPath?: string;
  displayName?: string;
};

function isDisplayIntegrationType(value: string): value is DisplayIntegrationType {
  return value === "linear" || (ALL_INTEGRATION_TYPES as readonly string[]).includes(value);
}

function humanizeOperation(value: string): string {
  return value.replaceAll(/[_-]+/g, " ").replaceAll(/\s+/g, " ").trim();
}

function humanizeSourceName(value: string): string {
  return value
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeExecutorMatchKey(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "");
}

function stripWorkspaceMcpServerSuffix(value: string): string {
  return value.replace(/(?:[-_\s]?)(mcp)$/i, "");
}

function parseWorkspaceMcpToolName(toolName: string): {
  namespace: string;
  operation: string;
} | null {
  const match = toolName.match(/^([a-z0-9-]+?)(?:_mcp)?[_:.](.+)$/i);
  if (!match) {
    return null;
  }

  const [, namespace, operation] = match;
  if (!namespace || !operation) {
    return null;
  }

  return {
    namespace,
    operation,
  };
}

function buildSourceAliases(source: WorkspaceMcpServerLike): string[] {
  const rawValues = [source.namespace, source.name ?? ""].filter(Boolean);
  const aliases = new Set<string>();

  for (const rawValue of rawValues) {
    const normalized = normalizeExecutorMatchKey(rawValue);
    if (normalized) {
      aliases.add(normalized);
    }

    const stripped = normalizeExecutorMatchKey(stripWorkspaceMcpServerSuffix(rawValue));
    if (stripped) {
      aliases.add(stripped);
    }
  }

  return [...aliases];
}

function detectIntegrationFromSource(
  source: WorkspaceMcpServerLike | undefined,
  sourceNamespace: string | null,
): DisplayIntegrationType | undefined {
  const candidates = new Set<string>();

  if (sourceNamespace) {
    candidates.add(normalizeExecutorMatchKey(sourceNamespace));
    candidates.add(normalizeExecutorMatchKey(stripWorkspaceMcpServerSuffix(sourceNamespace)));
  }

  if (source) {
    for (const alias of buildSourceAliases(source)) {
      candidates.add(alias);
    }
  }

  for (const integration of [...ALL_INTEGRATION_TYPES, "linear"] as const) {
    const normalized = normalizeExecutorMatchKey(integration);
    if (candidates.has(normalized)) {
      return integration;
    }
  }

  return undefined;
}

function findSourceMention(
  toolName: string | undefined,
  sources: readonly WorkspaceMcpServerLike[],
): WorkspaceMcpServerLike | undefined {
  if (!toolName) {
    return undefined;
  }
  const codeKeys = new Set<string>();
  codeKeys.add(normalizeExecutorMatchKey(toolName));
  const parsed = parseWorkspaceMcpToolName(toolName);
  if (parsed) {
    codeKeys.add(normalizeExecutorMatchKey(parsed.namespace));
    codeKeys.add(normalizeExecutorMatchKey(stripWorkspaceMcpServerSuffix(parsed.namespace)));
  }

  let bestScore = -1;
  let bestSource: WorkspaceMcpServerLike | undefined;

  for (const source of sources) {
    let score = -1;

    for (const alias of buildSourceAliases(source)) {
      if (!alias) {
        continue;
      }

      if (codeKeys.has(alias)) {
        score = Math.max(score, 100);
      } else if (
        [...codeKeys].some((candidate) => candidate.includes(alias) || alias.includes(candidate))
      ) {
        score = Math.max(score, 80);
      } else if (normalizeExecutorMatchKey(toolName).includes(alias)) {
        score = Math.max(score, 60);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestSource = source;
    }
  }

  return bestScore >= 0 ? bestSource : undefined;
}

function buildExecutorDisplayName(
  source: WorkspaceMcpServerLike | undefined,
  toolName: string | undefined,
): string {
  if (!toolName) {
    const sourceLabel = source?.name?.trim() || source?.namespace || "Computer";
    return source ? `${sourceLabel} MCP` : sourceLabel;
  }

  const parsedSourcePath = parseWorkspaceMcpToolName(toolName);
  if (parsedSourcePath) {
    const sourceLabel =
      source?.name?.trim() ||
      source?.namespace ||
      humanizeSourceName(stripWorkspaceMcpServerSuffix(parsedSourcePath.namespace));
    const leaf = parsedSourcePath.operation.split(".").at(-1) ?? parsedSourcePath.operation;
    return `${sourceLabel} MCP · ${humanizeOperation(leaf)}`;
  }

  if (source) {
    const sourceLabel = source.name?.trim() || source.namespace;
    return `${sourceLabel} MCP`;
  }

  return toolName;
}

export function getExecutorMetadataInput(input: unknown): unknown {
  return input;
}

export function getExecutorDisplayMetadata(
  input: unknown,
  sources: readonly WorkspaceMcpServerLike[] = [],
  toolName?: string,
): ExecutorDisplayMetadata {
  const metadataInput = getExecutorMetadataInput(input);
  const parsedToolName = toolName ? parseWorkspaceMcpToolName(toolName) : null;
  const source = findSourceMention(toolName, sources);
  const sourceNamespace = source?.namespace ?? parsedToolName?.namespace ?? null;
  const integration =
    detectIntegrationFromSource(source, sourceNamespace) ??
    (sourceNamespace && isDisplayIntegrationType(sourceNamespace) ? sourceNamespace : undefined);

  if (!source && !parsedToolName) {
    return { metadataInput };
  }

  return {
    metadataInput,
    integration,
    source,
    toolPath: toolName,
    displayName: buildExecutorDisplayName(source, toolName),
  };
}
