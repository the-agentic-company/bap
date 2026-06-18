import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type Dockerode from "dockerode";
import {
  canConnectDockerDaemon,
  createDockerClient,
  createRuntimeContainer,
  ensureDockerRuntimeImage,
  execInContainer,
  getRunningContainerById,
  readFileInContainer,
  removeContainerBestEffort,
  resolveMappedRuntimeUrl,
  writeFileInContainer,
} from "./docker-runtime";
import {
  createSandboxRuntimeClient,
  getSandboxReadinessUrl,
  getSandboxServerPort,
  getSandboxServerBackgroundStartCommand,
} from "./opencode-runtime";
import { conversationRuntimeService } from "../services/conversation-runtime-service";
import type {
  OpenCodeSandbox,
  OpenCodeSandboxInitResult,
  OpenCodeSessionConfig,
  OpenCodeSessionOptions,
  SessionInitLifecycleCallback,
} from "./opencode-session-types";
import {
  buildSandboxBootstrapEnv,
  escapeShell,
  getConversationRuntimeState,
  waitForServer,
} from "./opencode-session-support";

export function wrapDockerSandbox(container: Dockerode.Container): OpenCodeSandbox {
  return {
    provider: "docker",
    sandboxId: container.id,
    commands: {
      run: async (command, opts) => {
        const effectiveCommand = opts?.background
          ? `sh -lc ${escapeShell(`(${command}) >/tmp/opencode-bg.log 2>&1 &`)}`
          : command;

        return execInContainer({
          container,
          command: effectiveCommand,
          cwd: "/app",
          env: opts?.envs,
          timeoutMs: opts?.timeoutMs,
          onStderr: opts?.onStderr,
        });
      },
    },
    files: {
      write: async (path, content) => writeFileInContainer(container, path, content),
      read: async (path) => readFileInContainer(container, path),
    },
    teardown: async () => {
      await removeContainerBestEffort(container);
    },
  };
}

async function connectDockerSandboxById(
  docker: Dockerode,
  sandboxId: string,
): Promise<Dockerode.Container | null> {
  return getRunningContainerById(docker, sandboxId);
}

async function ensureDockerAgentReady(
  container: Dockerode.Container,
  config: OpenCodeSessionConfig,
  options?: OpenCodeSessionOptions,
): Promise<OpencodeClient> {
  const onLifecycle = options?.onLifecycle;
  const runtimePort = getSandboxServerPort(config.model);
  const baseUrl = await resolveMappedRuntimeUrl(container, runtimePort);
  const health = await fetch(getSandboxReadinessUrl(baseUrl, config.model), {
    method: "GET",
  }).catch(() => null);

  if (!health?.ok) {
    onLifecycle?.("opencode_starting", {
      conversationId: config.conversationId,
      sandboxId: container.id,
      port: runtimePort,
    });
    await execInContainer({
      container,
      command: getSandboxServerBackgroundStartCommand({
        sandboxId: container.id,
        model: config.model,
      }),
      cwd: "/app",
      timeoutMs: 10_000,
    });
    onLifecycle?.("opencode_waiting_ready", {
      conversationId: config.conversationId,
      sandboxId: container.id,
      serverUrl: baseUrl,
    });
    await waitForServer(baseUrl, config.model);
  }

  onLifecycle?.("opencode_ready", {
    conversationId: config.conversationId,
    sandboxId: container.id,
    serverUrl: baseUrl,
  });

  return await createSandboxRuntimeClient({ serverUrl: baseUrl, model: config.model });
}

export async function getOrCreateDockerSandbox(
  config: OpenCodeSessionConfig,
  onLifecycle?: SessionInitLifecycleCallback,
): Promise<{
  sandbox: OpenCodeSandbox;
  client: OpencodeClient;
  reused: boolean;
}> {
  const docker = createDockerClient();
  if (!(await canConnectDockerDaemon(docker))) {
    throw new Error("Docker daemon is not reachable");
  }

  onLifecycle?.("sandbox_checking_cache", { conversationId: config.conversationId });
  const runtimeState = await getConversationRuntimeState(config.conversationId);

  const connectAndValidate = async (container: Dockerode.Container | null) => {
    if (!container) {
      return null;
    }
    const baseUrl = await resolveMappedRuntimeUrl(container, getSandboxServerPort(config.model));
    const health = await fetch(getSandboxReadinessUrl(baseUrl, config.model), {
      method: "GET",
    }).catch(() => null);
    if (!health?.ok) {
      return null;
    }
    return {
      container,
      baseUrl,
    };
  };

  const fromConversation = runtimeState?.sandboxId
    ? await connectDockerSandboxById(docker, runtimeState.sandboxId)
    : null;

  const validConversationContainer = await connectAndValidate(fromConversation);
  if (validConversationContainer) {
    onLifecycle?.("sandbox_reused", {
      conversationId: config.conversationId,
      sandboxId: validConversationContainer.container.id,
    });
    return {
      sandbox: wrapDockerSandbox(validConversationContainer.container),
      client: await createSandboxRuntimeClient({
        serverUrl: validConversationContainer.baseUrl,
        model: config.model,
      }),
      reused: true,
    };
  }

  if (runtimeState?.sandboxId) {
    if (fromConversation) {
      await removeContainerBestEffort(fromConversation);
    }
    await conversationRuntimeService.markRuntimeDead(runtimeState.runtimeId);
  }

  onLifecycle?.("sandbox_creating", {
    conversationId: config.conversationId,
    template: "bap-agent-runtime",
  });

  const imageTag = await ensureDockerRuntimeImage(docker);
  const runtimePort = getSandboxServerPort(config.model);
  const created = await createRuntimeContainer({
    docker,
    imageTag,
    runtimePort,
    env: buildSandboxBootstrapEnv(config),
  });

  onLifecycle?.("sandbox_created", {
    conversationId: config.conversationId,
    sandboxId: created.id,
  });

  onLifecycle?.("opencode_starting", {
    conversationId: config.conversationId,
    sandboxId: created.id,
    port: runtimePort,
  });

  await execInContainer({
    container: created,
    command: getSandboxServerBackgroundStartCommand({
      sandboxId: created.id,
      model: config.model,
    }),
    cwd: "/app",
    timeoutMs: 10_000,
  });

  const baseUrl = await resolveMappedRuntimeUrl(created, runtimePort);
  onLifecycle?.("opencode_waiting_ready", {
    conversationId: config.conversationId,
    sandboxId: created.id,
    serverUrl: baseUrl,
  });
  await waitForServer(baseUrl, config.model);

  onLifecycle?.("opencode_ready", {
    conversationId: config.conversationId,
    sandboxId: created.id,
    serverUrl: baseUrl,
  });

  return {
    sandbox: wrapDockerSandbox(created),
    client: await createSandboxRuntimeClient({ serverUrl: baseUrl, model: config.model }),
    reused: false,
  };
}

export async function getOrCreateDockerSandboxInit(
  config: OpenCodeSessionConfig,
  onLifecycle?: SessionInitLifecycleCallback,
): Promise<OpenCodeSandboxInitResult> {
  const docker = createDockerClient();
  if (!(await canConnectDockerDaemon(docker))) {
    throw new Error("Docker daemon is not reachable");
  }

  onLifecycle?.("sandbox_checking_cache", { conversationId: config.conversationId });
  const runtimeState = await getConversationRuntimeState(config.conversationId);
  const fromConversation = runtimeState?.sandboxId
    ? await connectDockerSandboxById(docker, runtimeState.sandboxId)
    : null;

  if (fromConversation) {
    onLifecycle?.("sandbox_reused", {
      conversationId: config.conversationId,
      sandboxId: fromConversation.id,
    });
    return {
      sandbox: wrapDockerSandbox(fromConversation),
      reused: true,
      connectAgent: async (options) =>
        await ensureDockerAgentReady(fromConversation, config, options),
    };
  }

  if (runtimeState?.sandboxId) {
    if (fromConversation) {
      await removeContainerBestEffort(fromConversation);
    }
    await conversationRuntimeService.markRuntimeDead(runtimeState.runtimeId);
  }

  onLifecycle?.("sandbox_creating", {
    conversationId: config.conversationId,
    template: "bap-agent-runtime",
  });

  const imageTag = await ensureDockerRuntimeImage(docker);
  const runtimePort = getSandboxServerPort(config.model);
  const created = await createRuntimeContainer({
    docker,
    imageTag,
    runtimePort,
    env: buildSandboxBootstrapEnv(config),
  });

  onLifecycle?.("sandbox_created", {
    conversationId: config.conversationId,
    sandboxId: created.id,
  });

  return {
    sandbox: wrapDockerSandbox(created),
    reused: false,
    connectAgent: async (options) =>
      await ensureDockerAgentReady(created, config, options),
  };
}
