import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import { parseModelReference } from "../../lib/model-reference";
import type { SandboxAgentRuntime, SandboxSessionBridge } from "./runtime/types";
import {
  createSandboxRuntimeClientByRuntime,
  createSandboxSessionBridgeByRuntime,
} from "./runtime/factory";
import { createSandboxOpencodeClient } from "./runtime/runtime-client/opencode";

const OPENCODE_PORT = 4096;
const SANDBOX_AGENT_PORT = 2468;
const OPENCODE_CONFIG_PATH = "/app/opencode.json";

function joinUrlPath(baseUrl: string, path: string): string {
  const parsed = new URL(baseUrl);
  const normalizedBase = parsed.pathname.endsWith("/")
    ? parsed.pathname.slice(0, -1)
    : parsed.pathname;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  parsed.pathname = `${normalizedBase}${normalizedPath}`;
  return parsed.toString();
}

export function resolveSandboxAgentRuntimeForModel(model: string): SandboxAgentRuntime {
  const { providerID } = parseModelReference(model);
  return providerID === "anthropic" ? "agentsdk" : "opencode";
}

export function getSandboxServerBackgroundStartCommand(input: {
  sandboxId: string;
  model: string;
}): string {
  const runtime = resolveSandboxAgentRuntimeForModel(input.model);
  if (runtime === "agentsdk") {
    return `export SANDBOX_ID=${input.sandboxId} && cd /app && nohup sandbox-agent server --no-token --host 0.0.0.0 --port ${SANDBOX_AGENT_PORT} >/tmp/opencode.log 2>&1 &`;
  }

  return `export SANDBOX_ID=${input.sandboxId} OPENCODE_CONFIG=${OPENCODE_CONFIG_PATH} OPENCODE_ENABLE_EXPERIMENTAL_MODELS=true && cd /app && nohup opencode serve --port ${OPENCODE_PORT} --hostname 0.0.0.0 >/tmp/opencode.log 2>&1 &`;
}

export function getSandboxServerPort(model: string): number {
  return resolveSandboxAgentRuntimeForModel(model) === "agentsdk"
    ? SANDBOX_AGENT_PORT
    : OPENCODE_PORT;
}

export function getSandboxReadinessUrl(serverUrl: string, model: string): string {
  const runtime = resolveSandboxAgentRuntimeForModel(model);
  if (runtime === "agentsdk") {
    return joinUrlPath(serverUrl, "/v1/health");
  }
  // /health becomes ready earlier than /doc for OpenCode and reduces cold-start wait time.
  return joinUrlPath(serverUrl, "/health");
}

function getOpencodeClientBaseUrl(serverUrl: string, model: string): string {
  const runtime = resolveSandboxAgentRuntimeForModel(model);
  if (runtime === "agentsdk") {
    return joinUrlPath(serverUrl, "/opencode");
  }
  return serverUrl;
}

export async function createSandboxRuntimeClient(options: {
  serverUrl: string;
  model: string;
  fetch?: typeof fetch;
}): Promise<OpencodeClient> {
  const { model, ...adapterBaseOptions } = options;
  const sandboxAgentBaseUrl = options.serverUrl;
  const opencodeBaseUrl = getOpencodeClientBaseUrl(options.serverUrl, model);
  return createSandboxRuntimeClientByRuntime({
    runtime: resolveSandboxAgentRuntimeForModel(model),
    options: {
      ...adapterBaseOptions,
      sandboxAgentBaseUrl,
      opencodeBaseUrl,
    },
  });
}

async function createSandboxSessionBridge(options: {
  serverUrl: string;
  model: string;
  fetch?: typeof fetch;
}): Promise<SandboxSessionBridge> {
  const { model, ...adapterBaseOptions } = options;
  const sandboxAgentBaseUrl = options.serverUrl;
  const opencodeBaseUrl = getOpencodeClientBaseUrl(options.serverUrl, model);
  return createSandboxSessionBridgeByRuntime({
    runtime: resolveSandboxAgentRuntimeForModel(model),
    options: {
      ...adapterBaseOptions,
      sandboxAgentBaseUrl,
      opencodeBaseUrl,
    },
  });
}
