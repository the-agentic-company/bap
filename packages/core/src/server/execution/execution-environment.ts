import type {
  ConversationRuntimeOptions,
  RuntimeHarnessClient,
  RuntimeMcpServer,
  RuntimeSelection,
  SandboxHandle,
} from "../sandbox/core/types";

export interface ExecutionEnvironmentProvider {
  acquire(input: AcquireEnvironmentInput): Promise<ExecutionEnvironmentSession>;
  restore(input: RestoreEnvironmentInput): Promise<ExecutionEnvironmentSession>;
  acquireRuntime(input: AcquireRuntimeEnvironmentInput): Promise<ExecutionRuntimeSession>;
  release(input: ReleaseEnvironmentInput): Promise<void>;
}

export type SandboxProviderName = "docker" | "daytona" | "e2b";

export type AcquireEnvironmentInput = {
  conversationId: string;
  generationId: string;
  userId: string;
  model: string;
  anthropicApiKey: string;
  workspaceId?: string | null;
  providerPreference?: SandboxProviderName;
  openAIAuthSource?: "user" | "shared" | null;
  integrationEnvs?: Record<string, string>;
  env?: Record<string, string | null | undefined>;
  title?: string;
  replayHistory?: boolean;
  allowSnapshotRestore?: boolean;
  sessionMcpServers?: RuntimeMcpServer[];
  onLifecycle?: ConversationRuntimeOptions["onLifecycle"];
  telemetry?: Record<string, unknown>;
};

export type AcquireRuntimeEnvironmentInput = AcquireEnvironmentInput & {
  sessionMcpServers?: RuntimeMcpServer[];
};

export type RestoreEnvironmentInput = {
  conversationId: string;
  generationId: string;
  userId: string;
  snapshot: ExecutionEnvironmentSnapshotRef;
  env?: Record<string, string | null | undefined>;
};

export type ReleaseEnvironmentInput = {
  environmentId: string;
  reason: "completed" | "cancelled" | "failed" | "paused" | "worker_shutdown";
};

export type ExecutionEnvironmentSession = {
  environment: ExecutionEnvironment;
  metadata: ExecutionEnvironmentMetadata;
  sandbox: SandboxHandle;
  completeAgentInit(input?: {
    sessionMcpServers?: RuntimeMcpServer[];
  }): Promise<ExecutionRuntimeAgentInitResult>;
};

export type ExecutionRuntimeAgentInitResult = {
  runtimeClient: RuntimeHarnessClient;
  sessionId: string;
  sessionSource?: "live_session" | "restored_snapshot" | "created_session";
};

export type ExecutionRuntimeSession = ExecutionEnvironmentSession & {
  runtimeClient: RuntimeHarnessClient;
  sessionId: string;
  sessionSource?: "live_session" | "restored_snapshot" | "created_session";
};

export interface ExecutionEnvironment {
  id: string;
  execute(command: string, options?: ExecuteOptions): Promise<ExecuteResult>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  readFile(path: string): Promise<string>;
  ensureDir(path: string): Promise<void>;
  snapshot(input: SnapshotEnvironmentInput): Promise<ExecutionEnvironmentSnapshotRef>;
  release(input: ReleaseEnvironmentInput): Promise<void>;
}

export type ExecuteOptions = {
  timeoutMs?: number;
  env?: Record<string, string | null | undefined>;
  workdir?: string;
};

export type ExecuteResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type SnapshotEnvironmentInput = {
  reason: "run_deadline" | "decision_park" | "manual";
};

export type ExecutionEnvironmentSnapshotRef = {
  snapshotId: string;
  provider: SandboxProviderName;
  createdAt: Date;
};

export type ExecutionEnvironmentMetadata = {
  provider: SandboxProviderName;
  runtimeHarness?: RuntimeSelection["runtimeHarness"];
  runtimeProtocolVersion?: RuntimeSelection["runtimeProtocolVersion"];
  sandboxId?: string;
  selection?: RuntimeSelection;
};
