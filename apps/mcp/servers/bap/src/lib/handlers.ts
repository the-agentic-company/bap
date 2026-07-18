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
  if (!params.message.trim() && !params.fileAttachments?.length) {
    throw new Error("Chat run requires a message or at least one ready attachment.");
  }
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

export async function handleRunnerMarkFailed(params: {
  client: BapApiClient;
  reason: string;
  message?: string;
}) {
  return {
    status: "completed" as const,
    failure: await params.client.generation.markCurrentCoworkerRunFailed({
      reason: params.reason,
      message: params.message,
    }),
  };
}

export async function handleWorkspaceList(client: BapApiClient) {
  const overview = await client.billing.overview();
  return {
    status: "completed" as const,
    workspaces: overview.workspaces.map(({ active: _active, ...workspace }) => workspace),
  };
}

export async function handleWorkspaceCreate(params: { client: BapApiClient; name: string }) {
  const workspace = await params.client.billing.createWorkspace({ name: params.name });

  return {
    status: "completed" as const,
    workspace,
  };
}

export async function handleWorkspaceSave(params: {
  client: BapApiClient;
  workspaceId?: string;
  name: string;
}) {
  if (!params.workspaceId) {
    return handleWorkspaceCreate({ client: params.client, name: params.name });
  }

  return {
    status: "completed" as const,
    workspace: await params.client.billing.rename({
      workspaceId: params.workspaceId,
      name: params.name,
    }),
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

  const normalized = Array.isArray(result)
    ? { added: result, alreadyMembers: [], notFound: [] }
    : result;

  return buildWorkspaceAddMembersResponse({
    workspaceId: params.workspaceId,
    role: params.role ?? "member",
    added: normalized.added,
    alreadyMembers: normalized.alreadyMembers,
    notFound: normalized.notFound,
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
  reference: string;
  status: "on" | "off";
}) {
  const runner = createCoworkerRunner(params.client);
  const coworkerId = await runner.resolveReference(params.reference);
  await params.client.coworker.update({ id: coworkerId, status: params.status });
  return {
    status: "completed" as const,
    coworker: await params.client.coworker.get({ id: coworkerId }),
  };
}

export async function handleCoworkerDelete(params: { client: BapApiClient; reference: string }) {
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
  reference: string;
  payload?: unknown;
  userInput?: string;
  fileAttachments?: FileAttachmentInput[];
}) {
  const runner = createCoworkerRunner(params.client);
  const trustedUserInput = params.userInput?.trim();
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

export async function handleConnectedAccountRead(params: {
  client: BapApiClient;
  query: { type: "list"; integrationType?: string } | { type: "get"; connectedAccountId: string };
}) {
  const accounts = await params.client.integration.list();
  const matches = accounts.filter((account) => {
    if (params.query.type === "get") return account.id === params.query.connectedAccountId;
    return !params.query.integrationType || account.type === params.query.integrationType;
  });

  if (params.query.type === "get" && matches.length === 0) {
    throw new Error("Connected Account not found.");
  }

  return { status: "completed" as const, connectedAccounts: matches };
}

export async function handleConnectedAccountConnect(params: {
  client: BapApiClient;
  integrationType: string;
  redirectUrl: string;
  mode?: "connect" | "connect_to_label" | "reauth";
  accountLabel?: string;
  connectedAccountId?: string;
}) {
  const result = await params.client.integration.getAuthUrl({
    type: params.integrationType,
    redirectUrl: params.redirectUrl,
    mode: params.mode,
    accountLabel: params.accountLabel,
    connectedAccountId: params.connectedAccountId,
  });
  return { status: "completed" as const, integrationType: params.integrationType, ...result };
}

export async function handleConnectedAccountDisconnect(params: {
  client: BapApiClient;
  connectedAccountId: string;
}) {
  const result = await params.client.integration.disconnect({ id: params.connectedAccountId });
  return {
    status: "completed" as const,
    connectedAccountId: params.connectedAccountId,
    disconnected: result.success,
  };
}

export async function handleWorkspaceMemberList(params: {
  client: BapApiClient;
  workspaceId: string;
}) {
  const result = await params.client.billing.members({ workspaceId: params.workspaceId });
  return { status: "completed" as const, workspaceId: params.workspaceId, ...result };
}

export async function handleWorkspaceMemberSave(params: {
  client: BapApiClient;
  workspaceId: string;
  email: string;
  role: "admin" | "member";
}) {
  const current = await params.client.billing.members({ workspaceId: params.workspaceId });
  const member = current.members.find(
    (candidate) => candidate.email?.toLowerCase() === params.email.toLowerCase(),
  );
  if (member) {
    const updated = await params.client.billing.setMemberRole({
      workspaceId: params.workspaceId,
      email: params.email,
      role: params.role,
    });
    return {
      status: "completed" as const,
      workspaceId: params.workspaceId,
      access: { type: "membership" as const, ...updated },
    };
  }

  const invited = await params.client.billing.inviteMembers({
    workspaceId: params.workspaceId,
    emails: [params.email],
    role: params.role,
  });
  return {
    status: "completed" as const,
    workspaceId: params.workspaceId,
    access: {
      type: "invitation" as const,
      email: (Array.isArray(invited) ? invited[0] : invited.added[0]) ?? params.email,
      role: params.role,
    },
  };
}

export async function handleWorkspaceMemberRemove(params: {
  client: BapApiClient;
  workspaceId: string;
  email: string;
}) {
  const removed = await params.client.billing.removeMember({
    workspaceId: params.workspaceId,
    email: params.email,
  });
  return { status: "completed" as const, workspaceId: params.workspaceId, ...removed };
}

export async function handleWorkspaceMcpServerList(client: BapApiClient) {
  const result = await client.workspaceMcpServer.list();
  return {
    status: "completed" as const,
    workspaceId: result.workspaceId,
    membershipRole: result.membershipRole,
    servers: result.sources,
  };
}

type WorkspaceMcpServerValues = Partial<Omit<WorkspaceMcpServerInput, "kind">>;

function requireWorkspaceMcpServerCreateValues(
  values: WorkspaceMcpServerValues,
): WorkspaceMcpServerInput {
  if (!values.name || !values.namespace || !values.endpoint) {
    throw new Error("Workspace MCP Server creation requires name, namespace, and endpoint.");
  }
  return {
    kind: "mcp",
    ...values,
    name: values.name,
    namespace: values.namespace,
    endpoint: values.endpoint,
  };
}

export async function handleWorkspaceMcpServerSave(params: {
  client: BapApiClient;
  id?: string;
  values: WorkspaceMcpServerValues;
}) {
  if (Object.keys(params.values).length === 0) {
    throw new Error("Workspace MCP Server save must include at least one value.");
  }
  if (!params.id) {
    const created = await params.client.workspaceMcpServer.create(
      requireWorkspaceMcpServerCreateValues(params.values),
    );
    return { status: "completed" as const, id: created.id, created: true };
  }

  const current = (await params.client.workspaceMcpServer.list()).sources.find(
    (server) => server.id === params.id,
  );
  if (!current) throw new Error("Workspace MCP Server not found.");
  const input = requireWorkspaceMcpServerCreateValues({
    name: current.name,
    namespace: current.namespace,
    endpoint: current.endpoint,
    ...params.values,
  });
  await params.client.workspaceMcpServer.update({ id: params.id, ...input });
  return { status: "completed" as const, id: params.id, created: false };
}

export async function handleWorkspaceMcpServerDelete(params: { client: BapApiClient; id: string }) {
  await params.client.workspaceMcpServer.delete({ id: params.id });
  return { status: "completed" as const, id: params.id, deleted: true };
}

export async function handleWorkspaceMcpServerSetCredential(params: {
  client: BapApiClient;
  id: string;
  secret: string;
  displayName?: string | null;
  enabled?: boolean;
}) {
  await params.client.workspaceMcpServer.setCredential({
    workspaceMcpServerId: params.id,
    secret: params.secret,
    displayName: params.displayName,
    enabled: params.enabled,
  });
  return { status: "completed" as const, id: params.id };
}

export async function handleWorkspaceMcpServerStartOAuth(params: {
  client: BapApiClient;
  id: string;
  redirectUrl: string;
}) {
  const result = await params.client.workspaceMcpServer.startOAuth({
    workspaceMcpServerId: params.id,
    redirectUrl: params.redirectUrl,
  });
  return { status: "completed" as const, id: params.id, ...result };
}

export async function handleSkillRead(params: {
  client: BapApiClient;
  query: { type: "list" } | { type: "get"; id: string };
}) {
  if (params.query.type === "get") {
    return {
      status: "completed" as const,
      skill: await params.client.skill.get({ id: params.query.id }),
    };
  }
  return { status: "completed" as const, skills: await params.client.skill.list() };
}

export async function handleSkillSave(params: {
  client: BapApiClient;
  id?: string;
  values: {
    files?: Array<{ path: string; mimeType?: string; contentBase64: string }>;
    displayName?: string;
    description?: string;
    icon?: string | null;
    enabled?: boolean;
    visibility?: "public" | "private";
  };
}) {
  if (!params.id) {
    if (!params.values.files?.length) throw new Error("Skill creation requires files.");
    if (!params.values.files.some((file) => file.path === "SKILL.md")) {
      throw new Error("Skill creation requires a root SKILL.md file.");
    }
    const created = await handleSkillAdd({ client: params.client, files: params.values.files });
    const { visibility, files: _files, ...metadata } = params.values;
    if (Object.keys(metadata).length > 0) {
      await params.client.skill.update({ id: created.skill.id, ...metadata });
    }
    if (visibility === "public") await params.client.skill.share({ id: created.skill.id });
    return {
      status: "completed" as const,
      skill: await params.client.skill.get({ id: created.skill.id }),
    };
  }
  const current = await params.client.skill.get({ id: params.id });
  if (params.values.files !== undefined) {
    for (const file of params.values.files) {
      const existing = current.files.find((candidate) => candidate.path === file.path);
      if (existing) {
        await params.client.skill.updateFile({
          id: existing.id,
          contentBase64: file.contentBase64,
        });
      } else {
        await params.client.skill.addFile({
          skillId: params.id,
          path: file.path,
          contentBase64: file.contentBase64,
        });
      }
    }
  }
  const { visibility, files: _files, ...updates } = params.values;
  if (Object.keys(updates).length > 0) {
    await params.client.skill.update({ id: params.id, ...updates });
  }
  if (visibility) {
    if (visibility === "public") await params.client.skill.share({ id: params.id });
    else await params.client.skill.unshare({ id: params.id });
  }
  if (Object.keys(updates).length === 0 && !visibility && !params.values.files?.length) {
    throw new Error("Skill update must include at least one field.");
  }
  return { status: "completed" as const, skill: await params.client.skill.get({ id: params.id }) };
}

export async function handleSkillDelete(params: { client: BapApiClient; id: string }) {
  await params.client.skill.delete({ id: params.id });
  return { status: "completed" as const, id: params.id, deleted: true };
}

export async function handleCoworkerRead(params: {
  client: BapApiClient;
  query:
    | { type: "list" }
    | { type: "get"; reference: string }
    | { type: "export"; reference: string };
}) {
  if (params.query.type === "list") return handleCoworkerList(params.client);
  const result = await handleCoworkerGet(params.client, params.query.reference);
  if (params.query.type === "get") return result;
  const coworker = result.coworker;
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
      documents: coworker.documents,
    },
  };
}

export async function handleCoworkerSave(params: {
  client: BapApiClient;
  id?: string;
  values: {
    name?: string;
    description?: string | null;
    username?: string | null;
    status?: "on" | "off";
    favorite?: boolean;
    folderId?: string | null;
    trigger?: string;
    prompt?: string;
    autoApprove?: boolean;
    model?: string;
    authSource?: "user" | "shared" | null;
    toolAccessMode?: string;
    integrationTypes?: string[];
    customIntegrationIds?: string[];
    workspaceMcpServerIds?: string[];
    skillSlugs?: string[];
    schedule?: CoworkerSchedule;
    requiresUserInput?: boolean;
    userInputPrompt?: string | null;
  };
}) {
  if (!params.id) {
    const created = await handleCoworkerCreate({
      client: params.client,
      name: params.values.name,
      trigger: params.values.trigger,
      prompt: params.values.prompt,
      autoApprove: params.values.autoApprove,
      model: params.values.model,
      authSource: params.values.authSource ?? undefined,
      integrations: params.values.integrationTypes,
    });
    if (params.values.folderId !== undefined) {
      await params.client.coworkerFolder.moveCoworker({
        coworkerId: created.coworker.id,
        folderId: params.values.folderId,
      });
    }
    if (params.values.favorite !== undefined) {
      await params.client.coworker.update({
        id: created.coworker.id,
        isPinned: params.values.favorite,
      });
    }
    const needsFollowUp =
      params.values.description !== undefined ||
      params.values.username !== undefined ||
      params.values.status !== undefined ||
      params.values.customIntegrationIds !== undefined ||
      params.values.workspaceMcpServerIds !== undefined ||
      params.values.skillSlugs !== undefined ||
      params.values.schedule !== undefined ||
      params.values.requiresUserInput !== undefined ||
      params.values.userInputPrompt !== undefined;
    if (needsFollowUp) {
      await handleCoworkerUpdate({
        client: params.client,
        reference: created.coworker.id,
        description: params.values.description,
        username: params.values.username,
        status: params.values.status,
        customIntegrations: params.values.customIntegrationIds,
        workspaceMcpServerIds: params.values.workspaceMcpServerIds,
        skillSlugs: params.values.skillSlugs,
        schedule: params.values.schedule,
        requiresUserInput: params.values.requiresUserInput,
        userInputPrompt: params.values.userInputPrompt,
      });
    }
    return handleCoworkerGet(params.client, created.coworker.id);
  }

  const { folderId, favorite, ...values } = params.values;
  const updateValues = {
    name: values.name,
    description: values.description,
    username: values.username,
    status: values.status,
    trigger: values.trigger,
    prompt: values.prompt,
    autoApprove: values.autoApprove,
    model: values.model,
    authSource: values.authSource,
    toolAccessMode: values.toolAccessMode,
    integrations: values.integrationTypes,
    customIntegrations: values.customIntegrationIds,
    workspaceMcpServerIds: values.workspaceMcpServerIds,
    skillSlugs: values.skillSlugs,
    schedule: values.schedule,
    requiresUserInput: values.requiresUserInput,
    userInputPrompt: values.userInputPrompt,
  };
  const hasUpdate = Object.values(updateValues).some((value) => value !== undefined);
  if (hasUpdate) {
    await handleCoworkerUpdate({ client: params.client, reference: params.id, ...updateValues });
  }
  const runner = createCoworkerRunner(params.client);
  const coworkerId = await runner.resolveReference(params.id);
  if (folderId !== undefined) {
    await params.client.coworkerFolder.moveCoworker({ coworkerId, folderId });
  }
  if (favorite !== undefined) {
    await params.client.coworker.update({ id: coworkerId, isPinned: favorite });
  }
  if (!hasUpdate && folderId === undefined && favorite === undefined) {
    throw new Error("Coworker update must include at least one field.");
  }
  return handleCoworkerGet(params.client, coworkerId);
}

export async function handleCoworkerDocumentSave(params: {
  client: BapApiClient;
  coworkerReference: string;
  operation:
    | {
        type: "create";
        files: Array<{
          filename: string;
          mimeType: string;
          contentBase64: string;
          description?: string;
        }>;
      }
    | {
        type: "update";
        documentId: string;
        values: {
          filename?: string;
          description?: string | null;
          replacement?: { mimeType: string; contentBase64: string };
        };
      };
}) {
  if (params.operation.type === "create") {
    return handleCoworkerUploadDocument({
      client: params.client,
      reference: params.coworkerReference,
      files: params.operation.files,
    });
  }
  return handleCoworkerUpdateDocument({
    client: params.client,
    reference: params.coworkerReference,
    documentId: params.operation.documentId,
    filename: params.operation.values.filename,
    description: params.operation.values.description,
    mimeType: params.operation.values.replacement?.mimeType,
    contentBase64: params.operation.values.replacement?.contentBase64,
  });
}

export async function handleCoworkerRunStart(params: {
  client: BapApiClient;
  request:
    | {
        mode: "new";
        coworkerReference: string;
        input?: string;
        payload?: unknown;
        fileAttachments?: FileAttachmentInput[];
      }
    | {
        mode: "provideInput";
        runId: string;
        input: string;
        fileAttachments?: FileAttachmentInput[];
      };
}) {
  if (params.request.mode === "provideInput") {
    if (params.request.fileAttachments?.length) {
      throw new Error("Providing attachments while continuing a Coworker Run is not supported.");
    }
    return {
      status: "completed" as const,
      run: await handleCoworkerRunProvideInput({
        client: params.client,
        runId: params.request.runId,
        input: params.request.input,
      }),
    };
  }
  return handleCoworkerRun({
    client: params.client,
    reference: params.request.coworkerReference,
    payload: params.request.payload,
    userInput: params.request.input,
    fileAttachments: params.request.fileAttachments,
  });
}

export async function handleCoworkerRunProvideInput(params: {
  client: BapApiClient;
  runId: string;
  input: string;
}) {
  const run = await params.client.coworker.getRun({ id: params.runId });
  if (run.status !== "needs_user_input") {
    throw new Error(`Coworker Run is ${run.status}, not needs_user_input.`);
  }
  if (!run.conversationId) throw new Error("Coworker Run has no conversation.");
  return params.client.generation.startGeneration({
    conversationId: run.conversationId,
    content: params.input,
  });
}

export async function handleCoworkerRunResume(params: { client: BapApiClient; runId: string }) {
  const run = await params.client.coworker.getRun({ id: params.runId });
  if (run.status !== "paused" || !run.generationId) {
    throw new Error("Only a paused Coworker Run with a Generation can be resumed.");
  }
  const result = await params.client.generation.resumeGeneration({
    generationId: run.generationId,
  });
  return { status: "completed" as const, runId: params.runId, ...result };
}

export async function handleCoworkerRunCancel(params: { client: BapApiClient; runId: string }) {
  const run = await params.client.coworker.getRun({ id: params.runId });
  if (["completed", "error", "cancelled"].includes(run.status) || !run.generationId) {
    throw new Error(`Coworker Run cannot be cancelled from status ${run.status}.`);
  }
  const result = await params.client.generation.cancelGeneration({
    generationId: run.generationId,
  });
  return { status: "completed" as const, runId: params.runId, ...result };
}

export async function handleCoworkerRunRead(params: {
  client: BapApiClient;
  query:
    | {
        type: "list";
        cursor?: string;
        limit?: number;
        status?: CoworkerRunStatus;
        coworkerId?: string;
      }
    | { type: "logs"; runId: string }
    | { type: "downloadFile"; runId: string; fileId: string };
}) {
  if (params.query.type === "list") {
    return handleCoworkerRuns({ client: params.client, ...params.query });
  }
  if (params.query.type === "logs") return handleCoworkerLogs(params.client, params.query.runId);
  const { fileId } = params.query;
  const run = await params.client.coworker.getRun({ id: params.query.runId });
  if (!run.conversationId) {
    throw new Error("Coworker Run has no conversation files.");
  }
  const conversation = await params.client.conversation.get({ id: run.conversationId });
  const belongsToRun = conversation.messages.some((message) =>
    message.sandboxFiles.some((file) => file.fileId === fileId),
  );
  if (!belongsToRun) {
    throw new Error("File does not belong to this Coworker Run.");
  }
  return {
    status: "completed" as const,
    runId: params.query.runId,
    file: await params.client.conversation.downloadSandboxFile({ fileId }),
  };
}

export async function handleAttachmentPrepareUpload(params: {
  client: BapApiClient;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}) {
  const result = await params.client.fileAsset.createUpload({
    filename: params.filename,
    mimeType: params.mimeType,
    sizeBytes: params.sizeBytes,
  });
  return {
    status: "completed" as const,
    attachment: {
      attachmentId: result.uploadSessionId,
      uploadUrl: result.uploadUrl,
      expiresAt: result.expiresAt,
    },
  };
}

export async function handleAttachmentCompleteUpload(params: {
  client: BapApiClient;
  attachmentId: string;
}) {
  const file = await params.client.fileAsset.completeUpload({
    uploadSessionId: params.attachmentId,
  });
  return {
    status: "completed" as const,
    attachment: { attachmentId: file.id, ...file },
  };
}
