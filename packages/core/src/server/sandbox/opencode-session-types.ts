import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { ObservabilityContext } from "../utils/observability";
import type { OpenCodeMcpRuntimeWarning } from "./opencode-mcp-reconciliation";
import type { RuntimeMcpServer } from "./core/types";

export type SessionInitStage =
  | "sandbox_checking_cache"
  | "sandbox_reused"
  | "sandbox_creating"
  | "sandbox_created"
  | "opencode_starting"
  | "opencode_waiting_ready"
  | "opencode_ready"
  | "session_reused"
  | "session_creating"
  | "session_created"
  | "session_replay_started"
  | "session_replay_completed"
  | "session_init_completed";

export type SessionInitLifecycleCallback = (
  stage: SessionInitStage,
  details?: Record<string, unknown>,
) => void;

export type OpenCodeSessionOptions = {
  title?: string;
  replayHistory?: boolean;
  allowSnapshotRestore?: boolean;
  sessionMcpServers?: RuntimeMcpServer[];
  onLifecycle?: SessionInitLifecycleCallback;
  telemetry?: ObservabilityContext;
};

export type OpenCodeCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type OpenCodeSandbox = {
  provider: "e2b" | "daytona" | "docker";
  sandboxId: string;
  commands: {
    run: (
      command: string,
      opts?: {
        timeoutMs?: number;
        envs?: Record<string, string>;
        background?: boolean;
        onStderr?: (chunk: string) => void;
      },
    ) => Promise<OpenCodeCommandResult>;
  };
  files: {
    write: (path: string, content: string | ArrayBuffer) => Promise<void>;
    read: (path: string) => Promise<string>;
  };
  teardown?: () => Promise<void>;
};

export interface OpenCodeSessionConfig {
  conversationId: string;
  generationId?: string;
  userId?: string;
  model: string;
  anthropicApiKey: string;
  integrationEnvs?: Record<string, string>;
  openAIAuthSource?: "user" | "shared" | null;
}

export type OpenCodeSessionResult = {
  client: OpencodeClient;
  sessionId: string;
  sandbox: OpenCodeSandbox;
  sessionSource: "live_session" | "restored_snapshot" | "created_session";
  mcpWarnings?: OpenCodeMcpRuntimeWarning[];
};

export type OpenCodeSandboxInitResult = {
  sandbox: OpenCodeSandbox;
  reused: boolean;
  connectAgent: (options?: OpenCodeSessionOptions) => Promise<OpencodeClient>;
};

export interface OpenCodeSessionProvider {
  getOrCreateSession(
    config: OpenCodeSessionConfig,
    options?: OpenCodeSessionOptions,
  ): Promise<OpenCodeSessionResult>;
}
