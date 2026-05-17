import type {
  SandboxAgentRuntime,
  SandboxRuntimeAdapterOptions,
  SandboxRuntimeClientImplementation,
  SandboxSessionBridgeImplementation,
} from "./types";
import { sandboxAgentRuntimeClientImplementation } from "./runtime-client/agent-sdk";
import { opencodeRuntimeClientImplementation } from "./runtime-client/opencode";
import { sandboxAgentSessionBridgeImplementation } from "./session-bridge/agent-sdk";
import { opencodeSessionBridgeImplementation } from "./session-bridge/opencode";

function getSandboxRuntimeClientImplementation(input: {
  runtime: SandboxAgentRuntime;
}): SandboxRuntimeClientImplementation {
  if (input.runtime === "agentsdk") {
    return sandboxAgentRuntimeClientImplementation;
  }
  return opencodeRuntimeClientImplementation;
}

function getSandboxSessionBridgeImplementation(input: {
  runtime: SandboxAgentRuntime;
}): SandboxSessionBridgeImplementation {
  if (input.runtime === "agentsdk") {
    return sandboxAgentSessionBridgeImplementation;
  }
  return opencodeSessionBridgeImplementation;
}

export async function createSandboxRuntimeClientByRuntime(input: {
  runtime: SandboxAgentRuntime;
  options: SandboxRuntimeAdapterOptions;
}) {
  return getSandboxRuntimeClientImplementation({ runtime: input.runtime }).createRuntimeClient(
    input.options,
  );
}

export async function createSandboxSessionBridgeByRuntime(input: {
  runtime: SandboxAgentRuntime;
  options: SandboxRuntimeAdapterOptions;
}) {
  return getSandboxSessionBridgeImplementation({ runtime: input.runtime }).createSessionBridge(
    input.options,
  );
}
