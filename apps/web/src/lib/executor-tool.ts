import { ALL_INTEGRATION_TYPES, type DisplayIntegrationType } from "@/lib/integration-icons";

export type ExecutorSourceLike = {
  namespace: string;
  kind: "mcp" | "openapi";
  name?: string | null;
  endpoint?: string | null;
};

type ExecutorDisplayMetadata = {
  code: string | null;
  metadataInput: unknown;
  integration?: DisplayIntegrationType;
  source?: ExecutorSourceLike;
  toolPath?: string;
  displayName?: string;
};

const EXECUTOR_TOOL_NAMES = new Set(["executor_execute", "executor.execute"]);
const TOOL_BRACKET_PATH_PATTERN = /tools\[(["'])([^"'\\\]]+)\1\]/g;
const TOOL_DOT_PATH_PATTERN = /tools\.([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

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

function stripExecutorSourceSuffix(value: string): string {
  return value.replace(/(?:[-_\s]?)(mcp|openapi|api)$/i, "");
}

function parseExecutorSourcePath(path: string): {
  namespace: string;
  kind: "mcp" | "openapi";
  operation: string;
} | null {
  const match = path.match(/^([a-z0-9-]+)\.(mcp|openapi)\.(.+)$/i);
  if (!match) {
    return null;
  }

  const [, namespace, kind, operation] = match;
  if (!namespace || !kind || !operation) {
    return null;
  }

  return {
    namespace,
    kind: kind.toLowerCase() as "mcp" | "openapi",
    operation,
  };
}

function extractExecutorSourceNamespace(path: string): string | null {
  return parseExecutorSourcePath(path)?.namespace ?? null;
}

function buildSourceAliases(source: ExecutorSourceLike): string[] {
  const rawValues = [source.namespace, source.name ?? ""].filter(Boolean);
  const aliases = new Set<string>();

  for (const rawValue of rawValues) {
    const normalized = normalizeExecutorMatchKey(rawValue);
    if (normalized) {
      aliases.add(normalized);
    }

    const stripped = normalizeExecutorMatchKey(stripExecutorSourceSuffix(rawValue));
    if (stripped) {
      aliases.add(stripped);
    }
  }

  return [...aliases];
}

function detectIntegrationFromSource(
  source: ExecutorSourceLike | undefined,
  sourceNamespace: string | null,
): DisplayIntegrationType | undefined {
  const candidates = new Set<string>();

  if (sourceNamespace) {
    candidates.add(normalizeExecutorMatchKey(sourceNamespace));
    candidates.add(normalizeExecutorMatchKey(stripExecutorSourceSuffix(sourceNamespace)));
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
  code: string,
  toolPaths: readonly string[],
  sources: readonly ExecutorSourceLike[],
): ExecutorSourceLike | undefined {
  const codeKeys = new Set<string>();
  codeKeys.add(normalizeExecutorMatchKey(code));

  for (const toolPath of toolPaths) {
    const parsed = parseExecutorSourcePath(toolPath);
    if (!parsed) {
      continue;
    }

    codeKeys.add(normalizeExecutorMatchKey(parsed.namespace));
    codeKeys.add(normalizeExecutorMatchKey(stripExecutorSourceSuffix(parsed.namespace)));
  }

  let bestScore = -1;
  let bestSource: ExecutorSourceLike | undefined;

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
      } else if (normalizeExecutorMatchKey(code).includes(alias)) {
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
  source: ExecutorSourceLike | undefined,
  toolPath: string | null,
): string {
  if (!toolPath) {
    const sourceLabel = source?.name?.trim() || source?.namespace || "Computer";
    return source ? `${sourceLabel} ${source.kind.toUpperCase()}` : sourceLabel;
  }

  const parsedSourcePath = parseExecutorSourcePath(toolPath);
  if (parsedSourcePath) {
    const sourceLabel =
      source?.name?.trim() || source?.namespace || humanizeSourceName(parsedSourcePath.namespace);
    const leaf = parsedSourcePath.operation.split(".").at(-1) ?? parsedSourcePath.operation;
    return `${sourceLabel} ${parsedSourcePath.kind.toUpperCase()} · ${humanizeOperation(leaf)}`;
  }

  if (source) {
    const sourceLabel = source.name?.trim() || source.namespace;
    return `${sourceLabel} ${source.kind.toUpperCase()}`;
  }

  return "Computer";
}

export function isExecutorToolCall(toolName: string | undefined, input: unknown): boolean {
  if (toolName && EXECUTOR_TOOL_NAMES.has(toolName)) {
    return true;
  }

  return getExecutorCode(input) !== null;
}

export function getExecutorCode(input: unknown): string | null {
  if (!isRecord(input) || typeof input.code !== "string") {
    return null;
  }

  const code = input.code.trimEnd();
  return code.length > 0 ? code : null;
}

export function getExecutorMetadataInput(input: unknown): unknown {
  if (!isRecord(input) || !("code" in input)) {
    return input;
  }

  const next = { ...input };
  delete next.code;
  return Object.keys(next).length > 0 ? next : undefined;
}

function extractExecutorToolPaths(code: string): string[] {
  const matches: string[] = [];

  for (const match of code.matchAll(TOOL_BRACKET_PATH_PATTERN)) {
    const path = match[2]?.trim();
    if (path) {
      matches.push(path);
    }
  }

  for (const match of code.matchAll(TOOL_DOT_PATH_PATTERN)) {
    const path = match[1]?.trim();
    if (path) {
      matches.push(path);
    }
  }

  return [...new Set(matches)];
}

export function getExecutorDisplayMetadata(
  input: unknown,
  sources: readonly ExecutorSourceLike[] = [],
): ExecutorDisplayMetadata {
  const code = getExecutorCode(input);
  const metadataInput = getExecutorMetadataInput(input);

  if (!code) {
    return {
      code: null,
      metadataInput,
    };
  }

  const toolPaths = extractExecutorToolPaths(code);
  const toolPath =
    toolPaths.find((candidate) => extractExecutorSourceNamespace(candidate) !== null) ??
    toolPaths[0] ??
    null;
  const source = findSourceMention(code, toolPaths, sources);
  const sourceNamespace =
    source?.namespace ?? (toolPath ? extractExecutorSourceNamespace(toolPath) : null);
  const integration =
    detectIntegrationFromSource(source, sourceNamespace) ??
    (sourceNamespace && isDisplayIntegrationType(sourceNamespace) ? sourceNamespace : undefined);

  return {
    code,
    metadataInput,
    integration,
    source,
    toolPath: toolPath ?? undefined,
    displayName: buildExecutorDisplayName(source, toolPath),
  };
}
