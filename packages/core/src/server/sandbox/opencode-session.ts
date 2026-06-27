import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import {
  getOrCreateBareSandbox as getOrCreateBareE2BSandbox,
  getOrCreateSession as getOrCreateE2BSession,
} from "./e2b";
import { buildCustomSkillsAgentsFile } from "@bap/prompts";
export {
  buildIntegrationSkillsSystemPrompt as getIntegrationSkillsSystemPrompt,
  buildSkillsSystemPrompt as getSkillsSystemPrompt,
} from "@bap/prompts";
import { getPreferredCloudSandboxProvider } from "./factory";
import { resolvePreferredCommunitySkillsForUser } from "../services/integration-skill-service";
import { listAccessibleEnabledSkillsForUser } from "../services/workspace-skill-service";
import { downloadFromS3 } from "../storage/s3-client";
import {
  createSandboxRuntimeClient,
  getSandboxReadinessUrl,
  getSandboxServerPort,
  getSandboxServerBackgroundStartCommand,
  resolveSandboxAgentRuntimeForModel,
} from "./opencode-runtime";
import {
  type OpenCodeMcpRuntimeWarning,
  reconcileOpencodeMcpServers,
} from "./opencode-mcp-reconciliation";
import {
  readSandboxAppliedMcpConfigHash,
  writeSandboxAppliedMcpConfigHash,
} from "../redis/sandbox-mcp-config-cache";
import type {
  OpenCodeSandbox,
  OpenCodeSandboxInitResult,
  OpenCodeSessionConfig,
  OpenCodeSessionOptions,
  OpenCodeSessionProvider,
  OpenCodeSessionResult,
} from "./opencode-session-types";
import { waitForServer } from "./opencode-session-support";
import { reconcileOpenCodeSession } from "./opencode-session-reconcile";
import {
  getOrCreateDaytonaSandbox,
  getOrCreateDaytonaSandboxInit,
} from "./opencode-session-daytona";
import {
  getOrCreateDockerSandbox,
  getOrCreateDockerSandboxInit,
} from "./opencode-session-docker";

export type {
  OpenCodeCommandResult,
  OpenCodeSandbox,
  OpenCodeSessionConfig,
  OpenCodeSandboxInitResult,
} from "./opencode-session-types";

async function getOrCreateCloudSession(
  config: OpenCodeSessionConfig,
  options: OpenCodeSessionOptions | undefined,
  getOrCreateSandbox: (
    config: OpenCodeSessionConfig,
    onLifecycle?: OpenCodeSessionOptions["onLifecycle"],
  ) => Promise<{
    sandbox: OpenCodeSandbox;
    client: OpencodeClient;
    reused: boolean;
  }>,
): Promise<OpenCodeSessionResult> {
  const state = await getOrCreateSandbox(config, options?.onLifecycle);
  return reconcileOpenCodeSession({
    config,
    options,
    client: state.client,
    sandbox: state.sandbox,
    reused: state.reused,
  });
}

async function getOrCreateDaytonaSession(
  config: OpenCodeSessionConfig,
  options?: OpenCodeSessionOptions,
): Promise<OpenCodeSessionResult> {
  return getOrCreateCloudSession(config, options, getOrCreateDaytonaSandbox);
}

async function getOrCreateDockerSession(
  config: OpenCodeSessionConfig,
  options?: OpenCodeSessionOptions,
): Promise<OpenCodeSessionResult> {
  return getOrCreateCloudSession(config, options, getOrCreateDockerSandbox);
}

export async function getOrCreateSandboxForCloudProvider(
  provider: "e2b" | "daytona" | "docker",
  config: OpenCodeSessionConfig,
  options?: OpenCodeSessionOptions,
): Promise<OpenCodeSandboxInitResult> {
  if (provider === "daytona") {
    return await getOrCreateDaytonaSandboxInit(config, options?.onLifecycle);
  }
  if (provider === "docker") {
    return await getOrCreateDockerSandboxInit(config, options?.onLifecycle);
  }

  const state = await getOrCreateBareE2BSandbox(config, options?.onLifecycle, options?.telemetry);
  return {
    sandbox: {
      provider: "e2b",
      sandboxId: state.sandbox.sandboxId,
      commands: {
        run: async (command, opts) => {
          const result = await state.sandbox.commands.run(command, {
            timeoutMs: opts?.timeoutMs,
            envs: opts?.envs,
            background: opts?.background,
            onStderr: opts?.onStderr,
          });
          return {
            exitCode: result.exitCode ?? 0,
            stdout: result.stdout ?? "",
            stderr: result.stderr ?? "",
          };
        },
      },
      files: {
        write: async (path, content) => {
          await state.sandbox.files.write(path, content);
        },
        read: async (path) => state.sandbox.files.read(path),
      },
      teardown: async () => {
        await state.sandbox.kill().catch(() => {});
      },
    },
    reused: state.reused,
    connectAgent: async (agentOptions) => {
      const serverPort = getSandboxServerPort(config.model);
      const serverUrl = `https://${state.sandbox.getHost(serverPort)}`;
      const wrappedSandbox: OpenCodeSandbox = {
        provider: "e2b",
        sandboxId: state.sandbox.sandboxId,
        commands: {
          run: async (command, opts) => {
            const result = await state.sandbox.commands.run(command, {
              timeoutMs: opts?.timeoutMs,
              envs: opts?.envs,
              background: opts?.background,
              onStderr: opts?.onStderr,
            });
            return {
              exitCode: result.exitCode ?? 0,
              stdout: result.stdout ?? "",
              stderr: result.stderr ?? "",
            };
          },
        },
        files: {
          write: async (path, content) => {
            await state.sandbox.files.write(path, content);
          },
          read: async (path) => state.sandbox.files.read(path),
        },
        teardown: async () => {
          await state.sandbox.kill().catch(() => {});
        },
      };
      const health = await fetch(getSandboxReadinessUrl(serverUrl, config.model), {
        method: "GET",
      }).catch(() => null);

      if (!health?.ok) {
        agentOptions?.onLifecycle?.("opencode_starting", {
          conversationId: config.conversationId,
          sandboxId: state.sandbox.sandboxId,
          port: serverPort,
        });
        const startResult = await wrappedSandbox.commands.run(
          getSandboxServerBackgroundStartCommand({
            sandboxId: state.sandbox.sandboxId,
            model: config.model,
          }),
          { timeoutMs: 10_000 },
        );
        if (startResult.exitCode !== 0) {
          throw new Error(
            `OpenCode server start failed (exit=${startResult.exitCode}): ${
              startResult.stderr || startResult.stdout || "unknown error"
            }`,
          );
        }
        agentOptions?.onLifecycle?.("opencode_waiting_ready", {
          conversationId: config.conversationId,
          sandboxId: state.sandbox.sandboxId,
          serverUrl,
        });
        await waitForServer(serverUrl, config.model);
      }

      agentOptions?.onLifecycle?.("opencode_ready", {
        conversationId: config.conversationId,
        sandboxId: state.sandbox.sandboxId,
        serverUrl,
      });

      return await createSandboxRuntimeClient({
        serverUrl,
        model: config.model,
      });
    },
  };
}

export async function completeSessionInitForCloudProvider(
  _provider: "e2b" | "daytona" | "docker",
  sandboxInit: OpenCodeSandboxInitResult,
  config: OpenCodeSessionConfig,
  options?: OpenCodeSessionOptions,
): Promise<OpenCodeSessionResult> {
  const client = await sandboxInit.connectAgent(options);
  let mcpWarnings: OpenCodeMcpRuntimeWarning[] = [];
  if (resolveSandboxAgentRuntimeForModel(config.model) === "opencode") {
    const sandboxId = sandboxInit.sandbox.sandboxId;
    mcpWarnings = await reconcileOpencodeMcpServers({
      client,
      servers: options?.sessionMcpServers,
      appliedConfigStore: {
        read: () => readSandboxAppliedMcpConfigHash(sandboxId),
        write: (hash) => writeSandboxAppliedMcpConfigHash(sandboxId, hash),
      },
    });
  }

  return reconcileOpenCodeSession({
    config,
    options,
    client,
    sandbox: sandboxInit.sandbox,
    reused: sandboxInit.reused,
    mcpWarnings,
  });
}

async function getOrCreateSession(
  config: OpenCodeSessionConfig,
  options?: OpenCodeSessionOptions,
): Promise<OpenCodeSessionResult> {
  return getOrCreateSessionForCloudProvider(getPreferredCloudSandboxProvider(), config, options);
}

async function getOrCreateSessionForCloudProvider(
  provider: "e2b" | "daytona" | "docker",
  config: OpenCodeSessionConfig,
  options?: OpenCodeSessionOptions,
): Promise<OpenCodeSessionResult> {
  return getOpenCodeSessionProvider(provider).getOrCreateSession(config, options);
}

export async function writeSkillsToSandbox(
  sandbox: OpenCodeSandbox,
  userId: string,
  allowedSkillNames?: string[],
): Promise<string[]> {
  const filteredSkills = await listAccessibleEnabledSkillsForUser(userId, allowedSkillNames);

  if (filteredSkills.length === 0) {
    return [];
  }

  await sandbox.commands.run("mkdir -p /app/.opencode/skills");

  const writtenSkills: string[] = [];

  await filteredSkills.reduce<Promise<void>>(async (prev, s) => {
    await prev;
    const skillDir = `/app/.opencode/skills/${s.name}`;
    await sandbox.commands.run(`mkdir -p "${skillDir}"`);

    await Promise.all(
      s.files.map(async (file) => {
        const filePath = `${skillDir}/${file.path}`;
        const lastSlash = filePath.lastIndexOf("/");
        const parentDir = filePath.substring(0, lastSlash);
        if (parentDir !== skillDir) {
          await sandbox.commands.run(`mkdir -p "${parentDir}"`);
        }
        await sandbox.files.write(filePath, file.content ?? "");
      }),
    );

    await Promise.all(
      s.documents.map(async (doc) => {
        try {
          const buffer = await downloadFromS3(doc.fileAsset?.storageKey ?? doc.storageKey);
          const docPath = `${skillDir}/${doc.path ?? doc.filename}`;
          const lastSlash = docPath.lastIndexOf("/");
          const parentDir = docPath.substring(0, lastSlash);
          if (parentDir !== skillDir) {
            await sandbox.commands.run(`mkdir -p "${parentDir}"`);
          }
          const arrayBuffer = new Uint8Array(buffer).buffer;
          await sandbox.files.write(docPath, arrayBuffer);
        } catch (error) {
          console.error(
            `[OpenCodeSession] Failed to write document ${doc.path ?? doc.filename}:`,
            error,
          );
        }
      }),
    );

    writtenSkills.push(s.name);
  }, Promise.resolve());

  await sandbox.files.write("/app/.opencode/AGENTS.md", buildCustomSkillsAgentsFile(filteredSkills));

  return writtenSkills;
}

export async function writeResolvedIntegrationSkillsToSandbox(
  sandbox: OpenCodeSandbox,
  userId: string,
  allowedSlugs?: string[],
): Promise<string[]> {
  const resolved = await resolvePreferredCommunitySkillsForUser(userId, allowedSlugs);
  if (resolved.length === 0) {
    return [];
  }

  await sandbox.commands.run("mkdir -p /app/.opencode/integration-skills");
  const written: string[] = [];

  await Promise.all(
    resolved.map(async (entry) => {
      const skillDir = `/app/.opencode/integration-skills/${entry.slug}`;
      await sandbox.commands.run(`mkdir -p "${skillDir}"`);

      await Promise.all(
        entry.files.map(async (file) => {
          const filePath = `${skillDir}/${file.path}`;
          const lastSlash = filePath.lastIndexOf("/");
          const parentDir = filePath.substring(0, lastSlash);
          if (parentDir !== skillDir) {
            await sandbox.commands.run(`mkdir -p "${parentDir}"`);
          }
          await sandbox.files.write(filePath, file.content);
        }),
      );

      written.push(entry.slug);
    }),
  );

  return written;
}

function wrapE2BSession(
  session: Awaited<ReturnType<typeof getOrCreateE2BSession>>,
): OpenCodeSessionResult {
  return {
    client: session.client,
    sessionId: session.sessionId,
    sessionSource: session.sessionSource,
    sandbox: {
      provider: "e2b",
      sandboxId: session.sandbox.sandboxId,
      commands: {
        run: async (command, opts) => {
          const result = await session.sandbox.commands.run(command, {
            timeoutMs: opts?.timeoutMs,
            envs: opts?.envs,
            background: opts?.background,
            onStderr: opts?.onStderr,
          });
          return {
            exitCode: result.exitCode ?? 0,
            stdout: result.stdout ?? "",
            stderr: result.stderr ?? "",
          };
        },
      },
      files: {
        write: async (path, content) => {
          await session.sandbox.files.write(path, content);
        },
        read: async (path) => session.sandbox.files.read(path),
      },
      teardown: async () => {
        await session.sandbox.kill().catch(() => {});
      },
    },
  };
}

const e2bSessionProvider: OpenCodeSessionProvider = {
  async getOrCreateSession(config, options) {
    const session = await getOrCreateE2BSession(config, options);
    return wrapE2BSession(session);
  },
};

const daytonaSessionProvider: OpenCodeSessionProvider = {
  getOrCreateSession: getOrCreateDaytonaSession,
};

const dockerSessionProvider: OpenCodeSessionProvider = {
  getOrCreateSession: getOrCreateDockerSession,
};

function getOpenCodeSessionProvider(
  provider: "e2b" | "daytona" | "docker",
): OpenCodeSessionProvider {
  if (provider === "daytona") {
    return daytonaSessionProvider;
  }
  if (provider === "docker") {
    return dockerSessionProvider;
  }
  return e2bSessionProvider;
}
