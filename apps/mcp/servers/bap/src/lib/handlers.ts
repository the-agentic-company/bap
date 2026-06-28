import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@bap/core/lib/chat-model-defaults";
import {
  createCoworkerRunner,
  runChatSession,
  type BapApiClient,
  type CoworkerSchedule,
  type CoworkerRunStatus,
  type CoworkerUpdateInput,
  type FileAttachmentInput,
  type WorkspaceMcpServerInput,
} from "@bap/client";

export async function handleChatRun(params: {
  client: BapApiClient;
  message: string;
  conversationId?: string;
  model?: string;
  authSource?: "user" | "shared";
  sandbox?: "e2b" | "daytona" | "docker";
  autoApprove?: boolean;
  fileAttachments?: FileAttachmentInput[];
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
      fileAttachments: params.fileAttachments,
    },
  });

  return result;
}

export async function handleWorkspaceList(client: BapApiClient) {
  const overview = await client.billing.overview();
  return {
    status: "completed" as const,
    activeWorkspaceId: overview.owner.ownerId,
    workspaces: overview.workspaces,
  };
}

export async function handleWorkspaceSwitch(params: {
  client: BapApiClient;
  workspaceId: string;
}) {
  await params.client.billing.switchWorkspace({ workspaceId: params.workspaceId });
  const overview = await params.client.billing.overview();

  return {
    status: "completed" as const,
    activeWorkspaceId: overview.owner.ownerId,
    workspaces: overview.workspaces,
  };
}

export async function handleWorkspaceCreate(params: {
  client: BapApiClient;
  name: string;
}) {
  const workspace = await params.client.billing.createWorkspace({ name: params.name });
  const overview = await params.client.billing.overview();

  return {
    status: "completed" as const,
    workspace,
    activeWorkspaceId: overview.owner.ownerId,
    workspaces: overview.workspaces,
  };
}

function buildWorkspaceAddMembersResponse(params: {
  workspaceId: string;
  role?: "admin" | "member";
  added: string[];
  alreadyMembers: string[];
  notFound: string[];
}) {
  return {
    status: "completed" as const,
    workspaceId: params.workspaceId,
    role: params.role ?? "member",
    added: params.added,
    alreadyMembers: params.alreadyMembers,
    notFound: params.notFound,
  };
}

export async function handleWorkspaceAddMembers(params: {
  client: BapApiClient;
  workspaceId: string;
  emails: string[];
  role?: "admin" | "member";
}) {
  const result = await params.client.billing.inviteMembers({
    workspaceId: params.workspaceId,
    emails: params.emails,
    role: params.role,
  });

  return buildWorkspaceAddMembersResponse({
    workspaceId: params.workspaceId,
    role: params.role ?? "member",
    added: result.added,
    alreadyMembers: result.alreadyMembers,
    notFound: result.notFound,
  });
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

export async function handleCoworkerMove(params: {
  client: BapApiClient;
  reference: string;
  folderId?: string;
  folderPath?: string;
  folder?: null;
}) {
  const destinations = [
    params.folderId !== undefined,
    params.folderPath !== undefined,
    params.folder === null,
  ].filter(Boolean);
  if (destinations.length !== 1) {
    throw new Error("Coworker move must include exactly one destination.");
  }

  const runner = createCoworkerRunner(params.client);
  const coworkerId = await runner.resolveReference(params.reference);
  let destinationFolderId: string | null = null;
  let folder: Awaited<ReturnType<BapApiClient["coworkerFolder"]["createPath"]>> | undefined;

  if (params.folderId !== undefined) {
    destinationFolderId = params.folderId;
  }
  if (params.folderPath !== undefined) {
    const path = params.folderPath.trim();
    if (!path) {
      throw new Error("Coworker move folderPath must not be empty.");
    }
    folder = await params.client.coworkerFolder.createPath({ path });
    if (!folder) {
      throw new Error("Coworker move destination folder could not be created.");
    }
    destinationFolderId = folder.id;
  }

  await params.client.coworkerFolder.moveCoworker({
    coworkerId,
    folderId: destinationFolderId,
  });

  return {
    status: "completed" as const,
    coworker: await params.client.coworker.get({ id: coworkerId }),
    folder,
  };
}

export async function handleCoworkerMoveWorkspace(params: {
  client: BapApiClient;
  reference: string;
  targetWorkspaceId: string;
}) {
  const runner = createCoworkerRunner(params.client);
  const coworkerId = await runner.resolveReference(params.reference);
  const result = await params.client.coworker.moveWorkspace({
    coworkerId,
    targetWorkspaceId: params.targetWorkspaceId,
  });

  return {
    status: "completed" as const,
    ...result,
  };
}

export async function handleCoworkerSetFavorite(params: {
  client: BapApiClient;
  reference: string;
  favorite: boolean;
}) {
  const runner = createCoworkerRunner(params.client);
  const coworkerId = await runner.resolveReference(params.reference);
  await params.client.coworker.update({ id: coworkerId, isPinned: params.favorite });
  return {
    status: "completed" as const,
    coworker: await params.client.coworker.get({ id: coworkerId }),
  };
}

export async function handleCoworkerSetStatus(params: {
  client: BapApiClient;
  reference?: string;
  runId?: string;
  status: "on" | "off";
}) {
  // Cancel an in-flight run rather than toggling a coworker.
  if (params.runId) {
    if (params.status !== "off") {
      throw new Error(
        'Use status "off" with runId to cancel a run. To start a run, use coworker.run.',
      );
    }
    return handleRunCancel({ client: params.client, runId: params.runId });
  }

  if (!params.reference) {
    throw new Error(
      "coworker.setStatus requires either reference (a coworker) or runId (a run to cancel).",
    );
  }

  const runner = createCoworkerRunner(params.client);
  const coworkerId = await runner.resolveReference(params.reference);
  await params.client.coworker.update({ id: coworkerId, status: params.status });
  return {
    status: "completed" as const,
    coworker: await params.client.coworker.get({ id: coworkerId }),
  };
}

export async function handleCoworkerDelete(params: {
  client: BapApiClient;
  reference: string;
}) {
  const runner = createCoworkerRunner(params.client);
  const coworkerId = await runner.resolveReference(params.reference);
  const coworker = await params.client.coworker.get({ id: coworkerId });
  const result = await params.client.coworker.delete({ id: coworkerId });

  return {
    status: "completed" as const,
    coworkerId,
    deletedCoworker: coworker,
    ...result,
  };
}

export async function handleCoworkerRun(params: {
  client: BapApiClient;
  reference?: string;
  runId?: string;
  payload?: unknown;
  userInput?: string;
  fileAttachments?: FileAttachmentInput[];
}) {
  const trustedUserInput = params.userInput?.trim();

  // Continue an existing run instead of starting a new one.
  if (params.runId) {
    const run =
      trustedUserInput && trustedUserInput.length > 0
        ? await handleRunProvideInput({
            client: params.client,
            runId: params.runId,
            userInput: trustedUserInput,
          })
        : await handleRunResume({ client: params.client, runId: params.runId });
    return { status: "completed" as const, run };
  }

  if (!params.reference) {
    throw new Error(
      "coworker.run requires either reference (to start a run) or runId (to continue an existing run).",
    );
  }

  const runner = createCoworkerRunner(params.client);
  return {
    status: "completed" as const,
    run: await runner.run(params.reference, params.payload, {
      trustedUserInput:
        trustedUserInput && trustedUserInput.length > 0 ? trustedUserInput : undefined,
      fileAttachments: params.fileAttachments,
    }),
  };
}

export async function handleFileAssetCreateUpload(params: {
  client: BapApiClient;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}) {
  return {
    status: "completed" as const,
    upload: await params.client.fileAsset.createUpload({
      filename: params.filename,
      mimeType: params.mimeType,
      sizeBytes: params.sizeBytes,
    }),
  };
}

export async function handleFileAssetCompleteUpload(params: {
  client: BapApiClient;
  uploadSessionId: string;
}) {
  return {
    status: "completed" as const,
    file: await params.client.fileAsset.completeUpload({
      uploadSessionId: params.uploadSessionId,
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

// ---------- Integrations ----------

export async function handleIntegrationList(client: BapApiClient) {
  return {
    status: "completed" as const,
    integrations: await client.integration.list(),
  };
}

export async function handleIntegrationGetConnectUrl(params: {
  client: BapApiClient;
  type: string;
  redirectUrl: string;
  mode?: "connect" | "connect_to_label" | "reauth";
  accountLabel?: string;
  connectedAccountId?: string;
}) {
  const { authUrl } = await params.client.integration.getAuthUrl({
    type: params.type,
    redirectUrl: params.redirectUrl,
    mode: params.mode,
    accountLabel: params.accountLabel,
    connectedAccountId: params.connectedAccountId,
  });
  return {
    status: "completed" as const,
    type: params.type,
    authUrl,
  };
}

export async function handleIntegrationStatus(params: {
  client: BapApiClient;
  type?: string;
  id?: string;
}) {
  const integrations = await params.client.integration.list();
  const matches = integrations.filter(
    (item) =>
      (params.id === undefined || item.id === params.id) &&
      (params.type === undefined || item.type === params.type),
  );
  return {
    status: "completed" as const,
    integrations: matches.map((item) => ({
      id: item.id,
      type: item.type,
      displayName: item.displayName,
      enabled: item.enabled,
      authStatus: item.authStatus,
      authErrorCode: item.authErrorCode,
      scopes: item.scopes,
      accountLabel: item.accountLabel,
    })),
  };
}

export async function handleIntegrationDisconnect(params: { client: BapApiClient; id: string }) {
  const result = await params.client.integration.disconnect({ id: params.id });
  return {
    status: "completed" as const,
    id: params.id,
    success: result.success,
  };
}

// ---------- Run control ----------

export async function handleRunProvideInput(params: {
  client: BapApiClient;
  runId: string;
  userInput: string;
}) {
  const run = await params.client.coworker.getRun({ id: params.runId });
  if (run.status !== "needs_user_input") {
    throw new Error(
      `Run ${params.runId} is "${run.status}", not "needs_user_input"; cannot provide input.`,
    );
  }
  if (!run.conversationId) {
    throw new Error(`Run ${params.runId} has no conversation to receive input.`);
  }
  const result = await params.client.generation.startGeneration({
    conversationId: run.conversationId,
    content: params.userInput,
  });
  return {
    status: "completed" as const,
    runId: params.runId,
    conversationId: result.conversationId,
    generationId: result.generationId,
  };
}

export async function handleRunResume(params: { client: BapApiClient; runId: string }) {
  const run = await params.client.coworker.getRun({ id: params.runId });
  if (!run.generationId) {
    throw new Error(`Run ${params.runId} has no active generation to resume.`);
  }
  if (run.status !== "paused") {
    throw new Error(`Run ${params.runId} is "${run.status}", not "paused"; nothing to resume.`);
  }
  const result = await params.client.generation.resumeGeneration({
    generationId: run.generationId,
  });
  return {
    status: "completed" as const,
    runId: params.runId,
    generationId: run.generationId,
    success: result.success,
  };
}

const TERMINAL_RUN_STATUSES = ["completed", "error", "cancelled"];

export async function handleRunCancel(params: { client: BapApiClient; runId: string }) {
  const run = await params.client.coworker.getRun({ id: params.runId });
  if (TERMINAL_RUN_STATUSES.includes(run.status)) {
    throw new Error(`Run ${params.runId} is already "${run.status}"; nothing to cancel.`);
  }
  if (!run.generationId) {
    throw new Error(`Run ${params.runId} has no active generation to cancel.`);
  }
  const result = await params.client.generation.cancelGeneration({
    generationId: run.generationId,
  });
  return {
    status: "completed" as const,
    runId: params.runId,
    generationId: run.generationId,
    success: result.success,
  };
}

// ---------- Workspace MCP servers ----------

export async function handleWorkspaceMcpServerList(client: BapApiClient) {
  const result = await client.workspaceMcpServer.list();
  return {
    status: "completed" as const,
    workspaceId: result.workspaceId,
    membershipRole: result.membershipRole,
    servers: result.sources,
  };
}

export async function handleWorkspaceMcpServerCreate(params: {
  client: BapApiClient;
  input: WorkspaceMcpServerInput;
}) {
  const result = await params.client.workspaceMcpServer.create(params.input);
  return {
    status: "completed" as const,
    id: result.id,
  };
}

export async function handleWorkspaceMcpServerUpdate(params: {
  client: BapApiClient;
  id: string;
  input: WorkspaceMcpServerInput;
}) {
  await params.client.workspaceMcpServer.update({ id: params.id, ...params.input });
  return {
    status: "completed" as const,
    id: params.id,
  };
}

export async function handleWorkspaceMcpServerDelete(params: { client: BapApiClient; id: string }) {
  await params.client.workspaceMcpServer.delete({ id: params.id });
  return {
    status: "completed" as const,
    id: params.id,
    deleted: true,
  };
}

export async function handleWorkspaceMcpServerStartOAuth(params: {
  client: BapApiClient;
  workspaceMcpServerId: string;
  redirectUrl: string;
}) {
  const { authUrl } = await params.client.workspaceMcpServer.startOAuth({
    workspaceMcpServerId: params.workspaceMcpServerId,
    redirectUrl: params.redirectUrl,
  });
  return {
    status: "completed" as const,
    workspaceMcpServerId: params.workspaceMcpServerId,
    authUrl,
  };
}

export async function handleWorkspaceMcpServerSetCredential(params: {
  client: BapApiClient;
  workspaceMcpServerId: string;
  secret: string;
  displayName?: string | null;
  enabled?: boolean;
}) {
  await params.client.workspaceMcpServer.setCredential({
    workspaceMcpServerId: params.workspaceMcpServerId,
    secret: params.secret,
    displayName: params.displayName,
    enabled: params.enabled,
  });
  return {
    status: "completed" as const,
    workspaceMcpServerId: params.workspaceMcpServerId,
  };
}

export async function handleWorkspaceMcpServerDisconnectCredential(params: {
  client: BapApiClient;
  workspaceMcpServerId: string;
}) {
  await params.client.workspaceMcpServer.disconnectCredential({
    workspaceMcpServerId: params.workspaceMcpServerId,
  });
  return {
    status: "completed" as const,
    workspaceMcpServerId: params.workspaceMcpServerId,
  };
}

// ---------- Skills (lifecycle) ----------

export async function handleSkillList(client: BapApiClient) {
  return {
    status: "completed" as const,
    skills: await client.skill.list(),
  };
}

export async function handleSkillGet(params: { client: BapApiClient; id: string }) {
  return {
    status: "completed" as const,
    skill: await params.client.skill.get({ id: params.id }),
  };
}

export async function handleSkillUpdate(params: {
  client: BapApiClient;
  id: string;
  name?: string;
  displayName?: string;
  description?: string;
  icon?: string | null;
  enabled?: boolean;
}) {
  const updates: {
    name?: string;
    displayName?: string;
    description?: string;
    icon?: string | null;
    enabled?: boolean;
  } = {};
  if (params.name !== undefined) updates.name = params.name;
  if (params.displayName !== undefined) updates.displayName = params.displayName;
  if (params.description !== undefined) updates.description = params.description;
  if (params.icon !== undefined) updates.icon = params.icon;
  if (params.enabled !== undefined) updates.enabled = params.enabled;
  if (Object.keys(updates).length === 0) {
    throw new Error("Skill update must include at least one field.");
  }
  await params.client.skill.update({ id: params.id, ...updates });
  return {
    status: "completed" as const,
    skill: await params.client.skill.get({ id: params.id }),
  };
}

export async function handleSkillDelete(params: { client: BapApiClient; id: string }) {
  await params.client.skill.delete({ id: params.id });
  return {
    status: "completed" as const,
    id: params.id,
    deleted: true,
  };
}

export async function handleSkillSetEnabled(params: {
  client: BapApiClient;
  id: string;
  enabled: boolean;
}) {
  await params.client.skill.update({ id: params.id, enabled: params.enabled });
  return {
    status: "completed" as const,
    id: params.id,
    enabled: params.enabled,
  };
}

export async function handleSkillSetVisibility(params: {
  client: BapApiClient;
  id: string;
  visibility: "public" | "private";
}) {
  const result =
    params.visibility === "public"
      ? await params.client.skill.share({ id: params.id })
      : await params.client.skill.unshare({ id: params.id });
  return {
    status: "completed" as const,
    id: params.id,
    visibility: result.visibility,
  };
}

// ---------- Workspace members ----------

export async function handleMembersList(params: { client: BapApiClient; workspaceId: string }) {
  const result = await params.client.billing.members({ workspaceId: params.workspaceId });
  return {
    status: "completed" as const,
    workspaceId: params.workspaceId,
    membershipRole: result.membershipRole,
    members: result.members,
  };
}

export async function handleMembersSetRole(params: {
  client: BapApiClient;
  workspaceId: string;
  email: string;
  role: "admin" | "member";
}) {
  const result = await params.client.billing.setMemberRole({
    workspaceId: params.workspaceId,
    email: params.email,
    role: params.role,
  });
  return {
    status: "completed" as const,
    workspaceId: params.workspaceId,
    email: result.email,
    role: result.role,
  };
}

export async function handleMembersRemove(params: {
  client: BapApiClient;
  workspaceId: string;
  email: string;
}) {
  const result = await params.client.billing.removeMember({
    workspaceId: params.workspaceId,
    email: params.email,
  });
  return {
    status: "completed" as const,
    workspaceId: params.workspaceId,
    email: result.email,
    removed: true,
  };
}

// ---------- Coworker export / clone / file download ----------

export async function handleCoworkerExport(params: { client: BapApiClient; reference: string }) {
  const runner = createCoworkerRunner(params.client);
  const coworker = await runner.get(params.reference);
  return {
    status: "completed" as const,
    export: {
      version: 1 as const,
      name: coworker.name,
      description: coworker.description,
      username: coworker.username,
      triggerType: coworker.triggerType,
      prompt: coworker.prompt,
      model: coworker.model,
      authSource: coworker.authSource,
      autoApprove: coworker.autoApprove,
      toolAccessMode: coworker.toolAccessMode,
      allowedIntegrations: coworker.allowedIntegrations,
      allowedCustomIntegrations: coworker.allowedCustomIntegrations,
      allowedWorkspaceMcpServerIds: coworker.allowedWorkspaceMcpServerIds,
      allowedSkillSlugs: coworker.allowedSkillSlugs,
      schedule: coworker.schedule,
      requiresUserInput: coworker.requiresUserInput,
      userInputPrompt: coworker.userInputPrompt,
      documents: coworker.documents.map((doc) => ({
        filename: doc.filename,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        description: doc.description,
      })),
    },
  };
}

export async function handleCoworkerClone(params: {
  client: BapApiClient;
  reference: string;
  name?: string;
}) {
  const runner = createCoworkerRunner(params.client);
  const source = await runner.get(params.reference);

  const created = await runner.create({
    name: params.name ?? `${source.name} (copy)`,
    description: source.description,
    triggerType: source.triggerType,
    prompt: source.prompt,
    model: source.model,
    authSource: source.authSource,
    autoApprove: source.autoApprove,
    toolAccessMode: source.toolAccessMode,
    allowedIntegrations: source.allowedIntegrations,
    allowedCustomIntegrations: source.allowedCustomIntegrations,
    allowedWorkspaceMcpServerIds: source.allowedWorkspaceMcpServerIds,
    allowedSkillSlugs: source.allowedSkillSlugs,
    schedule: source.schedule,
    requiresUserInput: source.requiresUserInput,
    userInputPrompt: source.userInputPrompt,
  });

  return {
    status: "completed" as const,
    sourceId: source.id,
    coworker: created,
    documentsCopied: false,
    sourceDocumentCount: source.documents.length,
  };
}

export async function handleCoworkerDownloadFile(params: { client: BapApiClient; fileId: string }) {
  const file = await params.client.conversation.downloadSandboxFile({ fileId: params.fileId });
  return {
    status: "completed" as const,
    file,
  };
}
