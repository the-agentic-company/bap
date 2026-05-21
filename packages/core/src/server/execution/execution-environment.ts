export interface ExecutionEnvironmentProvider {
  acquire(input: AcquireEnvironmentInput): Promise<ExecutionEnvironmentSession>;
  restore(input: RestoreEnvironmentInput): Promise<ExecutionEnvironmentSession>;
  release(input: ReleaseEnvironmentInput): Promise<void>;
}

export type SandboxProviderName = "docker" | "daytona" | "e2b";

export type AcquireEnvironmentInput = {
  conversationId: string;
  generationId: string;
  userId: string;
  workspaceId?: string | null;
  providerPreference?: SandboxProviderName;
  env?: Record<string, string | null | undefined>;
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
};

export interface ExecutionEnvironment {
  id: string;
  execute(command: string, options?: ExecuteOptions): Promise<ExecuteResult>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  readFile(path: string): Promise<string>;
  ensureDir(path: string): Promise<void>;
  snapshot(input: SnapshotEnvironmentInput): Promise<ExecutionEnvironmentSnapshotRef>;
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
  runtimeHarness?: string;
  runtimeProtocolVersion?: string;
  sandboxId?: string;
};
