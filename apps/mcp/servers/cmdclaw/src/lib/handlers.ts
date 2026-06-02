import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@cmdclaw/core/lib/chat-model-defaults";
import {
  createCoworkerRunner,
  runChatSession,
  type CmdclawApiClient,
  type CoworkerRunStatus,
} from "@cmdclaw/client";

export async function handleChatRun(params: {
  client: CmdclawApiClient;
  message: string;
  conversationId?: string;
  model?: string;
  authSource?: "user" | "shared";
  sandbox?: "e2b" | "daytona" | "docker";
  autoApprove?: boolean;
}) {
  const result = await runChatSession({
    client: params.client,
    input: {
      content: params.message,
      conversationId: params.conversationId,
      model: params.model,
      authSource: params.authSource,
      sandboxProvider: params.sandbox,
      autoApprove: params.autoApprove,
    },
  });

  return result;
}

export async function handleCoworkerList(client: CmdclawApiClient) {
  const runner = createCoworkerRunner(client);
  return {
    status: "completed" as const,
    coworkers: await runner.list(),
  };
}

export async function handleCoworkerGet(client: CmdclawApiClient, reference: string) {
  const runner = createCoworkerRunner(client);
  return {
    status: "completed" as const,
    coworker: await runner.get(reference),
  };
}

export async function handleCoworkerCreate(params: {
  client: CmdclawApiClient;
  name?: string;
  trigger?: string;
  prompt?: string;
  promptDo?: string;
  promptDont?: string;
  autoApprove?: boolean;
  model?: string;
  authSource?: "user" | "shared";
  integrations?: string[];
  folderPath?: string;
}) {
  const runner = createCoworkerRunner(params.client);
  const created = await runner.create({
    name: params.name,
    triggerType: params.trigger ?? "manual",
    prompt: params.prompt ?? "",
    promptDo: params.promptDo,
    promptDont: params.promptDont,
    autoApprove: params.autoApprove,
    model: params.model ?? DEFAULT_CONNECTED_CHATGPT_MODEL,
    authSource: params.authSource,
    allowedIntegrations: params.integrations,
  });

  const trimmedFolderPath = params.folderPath?.trim();
  const folder = trimmedFolderPath
    ? await params.client.coworkerFolder.createPath({ path: trimmedFolderPath })
    : null;
  if (folder) {
    await params.client.coworkerFolder.moveCoworker({
      coworkerId: created.id,
      folderId: folder.id,
    });
  }

  return {
    status: "completed" as const,
    coworker: created,
    folder: folder ?? undefined,
  };
}

export async function handleCoworkerRun(params: {
  client: CmdclawApiClient;
  reference: string;
  payload?: unknown;
  userInput?: string;
}) {
  const runner = createCoworkerRunner(params.client);
  const trustedUserInput = params.userInput?.trim();
  return {
    status: "completed" as const,
    run: await runner.run(params.reference, params.payload, {
      trustedUserInput:
        trustedUserInput && trustedUserInput.length > 0 ? trustedUserInput : undefined,
    }),
  };
}

export async function handleCoworkerLogs(client: CmdclawApiClient, runId: string) {
  const runner = createCoworkerRunner(client);
  return {
    status: "completed" as const,
    run: await runner.logs(runId),
  };
}

export async function handleCoworkerRuns(params: {
  client: CmdclawApiClient;
  cursor?: string;
  limit?: number;
  status?: CoworkerRunStatus;
  coworkerId?: string;
}) {
  const result = await params.client.coworker.listWorkspaceRuns({
    cursor: params.cursor,
    limit: params.limit,
    status: params.status,
    coworkerId: params.coworkerId,
  });

  return {
    status: "completed" as const,
    ...result,
  };
}
