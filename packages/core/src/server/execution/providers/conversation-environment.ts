import { saveConversationSessionSnapshot } from "../../services/opencode-session-snapshot-service";
import {
  getOrCreateConversationRuntime,
  getOrCreateConversationSandbox,
} from "../../sandbox/core/orchestrator";
import type { SandboxHandle } from "../../sandbox/core/types";
import type {
  AcquireEnvironmentInput,
  AcquireRuntimeEnvironmentInput,
  ExecutionEnvironment,
  ExecutionEnvironmentMetadata,
  ExecutionEnvironmentProvider,
  ExecutionEnvironmentSession,
  ExecutionEnvironmentSnapshotRef,
  ExecutionRuntimeSession,
  ReleaseEnvironmentInput,
  RestoreEnvironmentInput,
  SandboxProviderName,
  SnapshotEnvironmentInput,
} from "../execution-environment";

function normalizeEnv(
  env: Record<string, string | null | undefined> | undefined,
): Record<string, string> | undefined {
  if (!env) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

class SandboxExecutionEnvironment implements ExecutionEnvironment {
  readonly id: string;

  constructor(
    private readonly provider: SandboxProviderName,
    private readonly sandbox: SandboxHandle,
    private readonly context: {
      conversationId: string;
      sessionId?: string;
    },
  ) {
    this.id = sandbox.sandboxId;
  }

  async execute(command: string, options?: Parameters<ExecutionEnvironment["execute"]>[1]) {
    return await this.sandbox.exec(command, {
      timeoutMs: options?.timeoutMs,
      env: normalizeEnv(options?.env),
    });
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    if (typeof content === "string") {
      await this.sandbox.writeFile(path, content);
      return;
    }
    const buffer = Buffer.from(content);
    await this.sandbox.writeFile(
      path,
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
    );
  }

  async readFile(path: string): Promise<string> {
    return await this.sandbox.readFile(path);
  }

  async ensureDir(path: string): Promise<void> {
    await this.sandbox.ensureDir(path);
  }

  async snapshot(_input: SnapshotEnvironmentInput): Promise<ExecutionEnvironmentSnapshotRef> {
    if (!this.context.sessionId) {
      throw new Error("Cannot snapshot execution environment before a runtime session is bound");
    }
    const snapshot = await saveConversationSessionSnapshot({
      conversationId: this.context.conversationId,
      sessionId: this.context.sessionId,
      sandbox: this.sandbox,
    });
    return {
      snapshotId: snapshot.storageKey,
      provider: this.provider,
      createdAt: snapshot.exportedAt,
    };
  }

  async release(_input: ReleaseEnvironmentInput): Promise<void> {
    await this.sandbox.teardown?.();
  }
}

function toMetadata(
  sandbox: SandboxHandle,
  selection: Awaited<ReturnType<typeof getOrCreateConversationSandbox>>["metadata"],
): ExecutionEnvironmentMetadata {
  return {
    provider: sandbox.provider,
    runtimeHarness: selection.runtimeHarness,
    runtimeProtocolVersion: selection.runtimeProtocolVersion,
    sandboxId: sandbox.sandboxId,
    selection,
  };
}

function toConversationContext(input: AcquireEnvironmentInput | RestoreEnvironmentInput) {
  return {
    conversationId: input.conversationId,
    generationId: input.generationId,
    userId: input.userId,
    model: "model" in input ? input.model : "anthropic/claude-sonnet-4-6",
    openAIAuthSource: "openAIAuthSource" in input ? input.openAIAuthSource : undefined,
    anthropicApiKey: "anthropicApiKey" in input ? input.anthropicApiKey : "",
    integrationEnvs: "integrationEnvs" in input ? input.integrationEnvs : undefined,
  };
}

function toRuntimeOptions(input: AcquireEnvironmentInput | RestoreEnvironmentInput) {
  const providerPreference =
    "snapshot" in input ? input.snapshot.provider : input.providerPreference;
  return {
    sandboxProviderOverride: providerPreference,
    title: "title" in input ? input.title : undefined,
    replayHistory: "replayHistory" in input ? input.replayHistory : false,
    allowSnapshotRestore:
      "allowSnapshotRestore" in input ? input.allowSnapshotRestore : true,
    sessionMcpServers:
      "sessionMcpServers" in input ? input.sessionMcpServers : undefined,
    onLifecycle: "onLifecycle" in input ? input.onLifecycle : undefined,
    telemetry: "telemetry" in input ? input.telemetry : undefined,
  };
}

export class ConversationExecutionEnvironmentProvider implements ExecutionEnvironmentProvider {
  constructor(private readonly provider: SandboxProviderName) {}

  async acquire(input: AcquireEnvironmentInput): Promise<ExecutionEnvironmentSession> {
    const sandboxInit = await getOrCreateConversationSandbox(
      toConversationContext(input),
      toRuntimeOptions({ ...input, providerPreference: this.provider }),
    );
    const environmentContext = {
      conversationId: input.conversationId,
      sessionId: undefined as string | undefined,
    };
    const environment = new SandboxExecutionEnvironment(
      this.provider,
      sandboxInit.sandbox,
      environmentContext,
    );
    return {
      environment,
      metadata: toMetadata(sandboxInit.sandbox, sandboxInit.metadata),
      sandbox: sandboxInit.sandbox,
      completeAgentInit: async (agentInput) => {
        const result = await sandboxInit.completeAgentInit(agentInput);
        environmentContext.sessionId = result.session.id;
        return {
          runtimeClient: result.harnessClient,
          sessionId: result.session.id,
          sessionSource: result.sessionSource,
        };
      },
    };
  }

  async restore(input: RestoreEnvironmentInput): Promise<ExecutionEnvironmentSession> {
    return await this.acquire({
      conversationId: input.conversationId,
      generationId: input.generationId,
      userId: input.userId,
      model: toConversationContext(input).model,
      anthropicApiKey: "",
      providerPreference: input.snapshot.provider,
      allowSnapshotRestore: true,
      env: input.env,
    });
  }

  async acquireRuntime(input: AcquireRuntimeEnvironmentInput): Promise<ExecutionRuntimeSession> {
    const runtime = await getOrCreateConversationRuntime(
      toConversationContext(input),
      toRuntimeOptions({ ...input, providerPreference: this.provider }),
    );
    const environment = new SandboxExecutionEnvironment(this.provider, runtime.sandbox, {
      conversationId: input.conversationId,
      sessionId: runtime.session.id,
    });
    return {
      environment,
      metadata: toMetadata(runtime.sandbox, runtime.metadata),
      sandbox: runtime.sandbox,
      completeAgentInit: async () => ({
        runtimeClient: runtime.harnessClient,
        sessionId: runtime.session.id,
        sessionSource: runtime.sessionSource,
      }),
      runtimeClient: runtime.harnessClient,
      sessionId: runtime.session.id,
      sessionSource: runtime.sessionSource,
    };
  }

  async release(input: ReleaseEnvironmentInput): Promise<void> {
    void input;
  }
}
