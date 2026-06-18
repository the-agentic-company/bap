import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@bap/core/lib/chat-model-defaults";
import {
  createCoworkerRunner,
  runChatSession,
  type BapApiClient,
  type CoworkerSchedule,
  type CoworkerRunStatus,
  type CoworkerUpdateInput,
} from "@bap/client";

export async function handleChatRun(params: {
  client: BapApiClient;
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

export async function handleCoworkerList(client: BapApiClient) {
  const runner = createCoworkerRunner(client);
  return {
    status: "completed" as const,
    coworkers: await runner.list(),
  };
}

export async function handleCoworkerGet(client: BapApiClient, reference: string) {
  const runner = createCoworkerRunner(client);
  return {
    status: "completed" as const,
    coworker: await runner.get(reference),
  };
}

export async function handleCoworkerCreate(params: {
  client: BapApiClient;
  name?: string;
  trigger?: string;
  prompt?: string;
  autoApprove?: boolean;
  model?: string;
  authSource?: "user" | "shared";
  integrations?: string[];
  folderPath?: string;
  files?: Array<{
    filename: string;
    mimeType: string;
    contentBase64: string;
    description?: string;
  }>;
}) {
  const runner = createCoworkerRunner(params.client);
  const allowedIntegrations =
    params.integrations && params.integrations.length > 0 ? params.integrations : undefined;
  const created = await runner.create({
    name: params.name,
    triggerType: params.trigger ?? "manual",
    prompt: params.prompt ?? "",
    autoApprove: params.autoApprove,
    model: params.model ?? DEFAULT_CONNECTED_CHATGPT_MODEL,
    authSource: params.authSource,
    toolAccessMode: allowedIntegrations ? "selected" : undefined,
    allowedIntegrations,
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

  const documents = params.files?.length
    ? await Promise.all(
        params.files.map((file) =>
          params.client.coworker.uploadDocument({
            coworkerId: created.id,
            filename: file.filename,
            mimeType: file.mimeType,
            content: file.contentBase64,
            description: file.description,
          }),
        ),
      )
    : [];

  return {
    status: "completed" as const,
    coworker: created,
    folder: folder ?? undefined,
    documents,
  };
}

export async function handleCoworkerUpdate(params: {
  client: BapApiClient;
  reference: string;
  name?: string;
  description?: string | null;
  username?: string | null;
  status?: "on" | "off";
  trigger?: string;
  prompt?: string;
  autoApprove?: boolean;
  isPinned?: boolean;
  model?: string;
  authSource?: "user" | "shared" | null;
  toolAccessMode?: string;
  integrations?: string[];
  customIntegrations?: string[];
  workspaceMcpServerIds?: string[];
  skillSlugs?: string[];
  schedule?: CoworkerSchedule;
  requiresUserInput?: boolean;
  userInputPrompt?: string | null;
}) {
  const runner = createCoworkerRunner(params.client);
  const coworkerId = await runner.resolveReference(params.reference);
  const updates: Omit<CoworkerUpdateInput, "id"> = {};

  if (params.name !== undefined) updates.name = params.name;
  if (params.description !== undefined) updates.description = params.description;
  if (params.username !== undefined) updates.username = params.username;
  if (params.status !== undefined) updates.status = params.status;
  if (params.trigger !== undefined) updates.triggerType = params.trigger;
  if (params.prompt !== undefined) updates.prompt = params.prompt;
  if (params.autoApprove !== undefined) updates.autoApprove = params.autoApprove;
  if (params.isPinned !== undefined) updates.isPinned = params.isPinned;
  if (params.model !== undefined) updates.model = params.model;
  if (params.authSource !== undefined) updates.authSource = params.authSource;
  if (params.toolAccessMode !== undefined) updates.toolAccessMode = params.toolAccessMode;
  if (params.integrations !== undefined) updates.allowedIntegrations = params.integrations;
  if (params.customIntegrations !== undefined) {
    updates.allowedCustomIntegrations = params.customIntegrations;
  }
  if (params.workspaceMcpServerIds !== undefined) {
    updates.allowedWorkspaceMcpServerIds = params.workspaceMcpServerIds;
  }
  if (params.skillSlugs !== undefined) updates.allowedSkillSlugs = params.skillSlugs;
  if (params.schedule !== undefined) updates.schedule = params.schedule;
  if (params.requiresUserInput !== undefined) updates.requiresUserInput = params.requiresUserInput;
  if (params.userInputPrompt !== undefined) updates.userInputPrompt = params.userInputPrompt;

  if (Object.keys(updates).length === 0) {
    throw new Error("Coworker update must include at least one field.");
  }

  await params.client.coworker.update({ id: coworkerId, ...updates });
  return {
    status: "completed" as const,
    coworker: await params.client.coworker.get({ id: coworkerId }),
  };
}

export async function handleCoworkerRun(params: {
  client: BapApiClient;
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

async function requireCoworkerDocument(params: {
  client: BapApiClient;
  coworkerId: string;
  documentId: string;
}) {
  const coworker = await params.client.coworker.get({ id: params.coworkerId });
  const document = coworker.documents.find((candidate) => candidate.id === params.documentId);
  if (!document) {
    throw new Error("Document does not belong to the referenced coworker.");
  }
  return { coworker, document };
}

export async function handleCoworkerUpdateDocument(params: {
  client: BapApiClient;
  reference: string;
  documentId: string;
  filename?: string;
  mimeType?: string;
  contentBase64?: string;
  description?: string | null;
}) {
  const hasFilename = params.filename !== undefined;
  const hasMimeType = params.mimeType !== undefined;
  const hasContent = params.contentBase64 !== undefined;
  const hasDescription = params.description !== undefined;
  const isFileReplacement = hasContent || hasMimeType;

  if (!hasFilename && !hasDescription && !isFileReplacement) {
    throw new Error("Document update must include at least one field.");
  }
  if (isFileReplacement && (!params.filename || !params.mimeType || !params.contentBase64)) {
    throw new Error("File replacement requires filename, mimeType, and contentBase64.");
  }

  const runner = createCoworkerRunner(params.client);
  const coworkerId = await runner.resolveReference(params.reference);
  await requireCoworkerDocument({
    client: params.client,
    coworkerId,
    documentId: params.documentId,
  });

  const document = await params.client.coworker.updateDocument({
    id: params.documentId,
    filename: params.filename,
    mimeType: params.mimeType,
    content: params.contentBase64,
    description: params.description,
  });

  return {
    status: "completed" as const,
    coworkerId,
    document,
  };
}

export async function handleCoworkerDeleteDocument(params: {
  client: BapApiClient;
  reference: string;
  documentId: string;
}) {
  const runner = createCoworkerRunner(params.client);
  const coworkerId = await runner.resolveReference(params.reference);
  await requireCoworkerDocument({
    client: params.client,
    coworkerId,
    documentId: params.documentId,
  });
  const result = await params.client.coworker.deleteDocument({ id: params.documentId });

  return {
    status: "completed" as const,
    coworkerId,
    ...result,
  };
}

export async function handleCoworkerUploadDocument(params: {
  client: BapApiClient;
  reference: string;
  files: Array<{
    filename: string;
    mimeType: string;
    contentBase64: string;
    description?: string;
  }>;
}) {
  const runner = createCoworkerRunner(params.client);
  const coworkerId = await runner.resolveReference(params.reference);
  const documents = await Promise.all(
    params.files.map((file) =>
      params.client.coworker.uploadDocument({
        coworkerId,
        filename: file.filename,
        mimeType: file.mimeType,
        content: file.contentBase64,
        description: file.description,
      }),
    ),
  );

  return {
    status: "completed" as const,
    coworkerId,
    documents,
  };
}

export async function handleCoworkerLogs(client: BapApiClient, runId: string) {
  const runner = createCoworkerRunner(client);
  return {
    status: "completed" as const,
    run: await runner.logs(runId),
  };
}

export async function handleCoworkerRuns(params: {
  client: BapApiClient;
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

export async function handleSkillAdd(params: {
  client: BapApiClient;
  files: Array<{
    path: string;
    mimeType?: string;
    contentBase64: string;
  }>;
}) {
  const created = await params.client.skill.import({
    mode: "folder",
    files: params.files,
  });

  return {
    status: "completed" as const,
    skill: created,
  };
}
