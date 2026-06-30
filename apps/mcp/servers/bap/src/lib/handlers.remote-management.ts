import type { BapApiClient } from "@bap/client";
import {
  handleIntegrationDisconnect,
  handleIntegrationGetConnectUrl,
  handleIntegrationList,
  handleIntegrationStatus,
  handleMembersList,
  handleMembersRemove,
  handleMembersSetRole,
  handleSkillAdd,
  handleSkillDelete,
  handleSkillGet,
  handleSkillList,
  handleSkillSetEnabled,
  handleSkillSetVisibility,
  handleSkillUpdate,
  handleWorkspaceMcpServerCreate,
  handleWorkspaceMcpServerDelete,
  handleWorkspaceMcpServerDisconnectCredential,
  handleWorkspaceMcpServerList,
  handleWorkspaceMcpServerSetCredential,
  handleWorkspaceMcpServerStartOAuth,
  handleWorkspaceMcpServerUpdate,
} from "./handlers";

// Action-param dispatchers that fold many small tools into one flexible tool
// each. Each action maps to a tiny router that validates its own requirements
// and delegates to the focused, individually-tested handler in ./handlers.

function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

function requireNonEmpty<T>(value: T[] | undefined, message: string): T[] {
  if (!value || value.length === 0) {
    throw new Error(message);
  }
  return value;
}

// ---------- Integrations ----------

export type IntegrationAction = "list" | "status" | "connect" | "disconnect";

export type IntegrationParams = {
  client: BapApiClient;
  action: IntegrationAction;
  type?: string;
  id?: string;
  redirectUrl?: string;
  mode?: "connect" | "connect_to_label" | "reauth";
  accountLabel?: string;
  connectedAccountId?: string;
};

const INTEGRATION_ACTIONS = {
  list: (p: IntegrationParams) => handleIntegrationList(p.client),
  status: (p: IntegrationParams) =>
    handleIntegrationStatus({ client: p.client, type: p.type, id: p.id }),
  connect: (p: IntegrationParams) =>
    handleIntegrationGetConnectUrl({
      client: p.client,
      type: required(p.type, 'integration connect requires "type".'),
      redirectUrl: required(p.redirectUrl, "integration connect requires a redirectUrl."),
      mode: p.mode,
      accountLabel: p.accountLabel,
      connectedAccountId: p.connectedAccountId,
    }),
  disconnect: (p: IntegrationParams) =>
    handleIntegrationDisconnect({
      client: p.client,
      id: required(p.id, 'integration disconnect requires "id".'),
    }),
} satisfies Record<IntegrationAction, (p: IntegrationParams) => Promise<unknown>>;

export async function handleIntegration(params: IntegrationParams) {
  return INTEGRATION_ACTIONS[params.action](params);
}

// ---------- Workspace MCP servers ----------

export type WorkspaceMcpServerAction =
  | "list"
  | "create"
  | "update"
  | "delete"
  | "setCredential"
  | "connect"
  | "disconnect";

export type WorkspaceMcpServerParams = {
  client: BapApiClient;
  action: WorkspaceMcpServerAction;
  id?: string;
  name?: string;
  namespace?: string;
  endpoint?: string;
  specUrl?: string | null;
  transport?: string | null;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  defaultHeaders?: Record<string, string>;
  authType?: "none" | "api_key" | "bearer" | "oauth2";
  authHeaderName?: string | null;
  authQueryParam?: string | null;
  authPrefix?: string | null;
  enabled?: boolean;
  secret?: string;
  displayName?: string | null;
  redirectUrl?: string;
};

function buildMcpServerInput(p: WorkspaceMcpServerParams) {
  return {
    kind: "mcp" as const,
    name: required(p.name, `workspaceMcpServer ${p.action} requires a name.`),
    namespace: required(p.namespace, `workspaceMcpServer ${p.action} requires a namespace.`),
    endpoint: required(p.endpoint, `workspaceMcpServer ${p.action} requires an endpoint.`),
    specUrl: p.specUrl,
    transport: p.transport,
    headers: p.headers,
    queryParams: p.queryParams,
    defaultHeaders: p.defaultHeaders,
    authType: p.authType,
    authHeaderName: p.authHeaderName,
    authQueryParam: p.authQueryParam,
    authPrefix: p.authPrefix,
    enabled: p.enabled,
  };
}

const WORKSPACE_MCP_SERVER_ACTIONS = {
  list: (p: WorkspaceMcpServerParams) => handleWorkspaceMcpServerList(p.client),
  create: (p: WorkspaceMcpServerParams) =>
    handleWorkspaceMcpServerCreate({ client: p.client, input: buildMcpServerInput(p) }),
  update: (p: WorkspaceMcpServerParams) =>
    handleWorkspaceMcpServerUpdate({
      client: p.client,
      id: required(p.id, "workspaceMcpServer update requires an id."),
      input: buildMcpServerInput(p),
    }),
  delete: (p: WorkspaceMcpServerParams) =>
    handleWorkspaceMcpServerDelete({
      client: p.client,
      id: required(p.id, "workspaceMcpServer delete requires an id."),
    }),
  setCredential: (p: WorkspaceMcpServerParams) =>
    handleWorkspaceMcpServerSetCredential({
      client: p.client,
      workspaceMcpServerId: required(p.id, "workspaceMcpServer setCredential requires an id."),
      secret: required(p.secret, "workspaceMcpServer setCredential requires a secret."),
      displayName: p.displayName,
      enabled: p.enabled,
    }),
  connect: (p: WorkspaceMcpServerParams) =>
    handleWorkspaceMcpServerStartOAuth({
      client: p.client,
      workspaceMcpServerId: required(p.id, "workspaceMcpServer connect requires an id."),
      redirectUrl: required(p.redirectUrl, "workspaceMcpServer connect requires a redirectUrl."),
    }),
  disconnect: (p: WorkspaceMcpServerParams) =>
    handleWorkspaceMcpServerDisconnectCredential({
      client: p.client,
      workspaceMcpServerId: required(p.id, "workspaceMcpServer disconnect requires an id."),
    }),
} satisfies Record<WorkspaceMcpServerAction, (p: WorkspaceMcpServerParams) => Promise<unknown>>;

export async function handleWorkspaceMcpServerAction(params: WorkspaceMcpServerParams) {
  return WORKSPACE_MCP_SERVER_ACTIONS[params.action](params);
}

// ---------- Skills ----------

export type SkillAction =
  | "list"
  | "get"
  | "add"
  | "update"
  | "delete"
  | "setEnabled"
  | "setVisibility";

export type SkillParams = {
  client: BapApiClient;
  action: SkillAction;
  id?: string;
  files?: Array<{ path: string; mimeType?: string; contentBase64: string }>;
  name?: string;
  displayName?: string;
  description?: string;
  icon?: string | null;
  enabled?: boolean;
  visibility?: "public" | "private";
};

const SKILL_ACTIONS = {
  list: (p: SkillParams) => handleSkillList(p.client),
  get: (p: SkillParams) =>
    handleSkillGet({ client: p.client, id: required(p.id, 'skill get requires "id".') }),
  add: (p: SkillParams) =>
    handleSkillAdd({ client: p.client, files: requireNonEmpty(p.files, "skill add requires files.") }),
  update: (p: SkillParams) =>
    handleSkillUpdate({
      client: p.client,
      id: required(p.id, 'skill update requires "id".'),
      name: p.name,
      displayName: p.displayName,
      description: p.description,
      icon: p.icon,
      enabled: p.enabled,
    }),
  delete: (p: SkillParams) =>
    handleSkillDelete({ client: p.client, id: required(p.id, 'skill delete requires "id".') }),
  setEnabled: (p: SkillParams) =>
    handleSkillSetEnabled({
      client: p.client,
      id: required(p.id, 'skill setEnabled requires "id".'),
      enabled: required(p.enabled, "skill setEnabled requires enabled."),
    }),
  setVisibility: (p: SkillParams) =>
    handleSkillSetVisibility({
      client: p.client,
      id: required(p.id, 'skill setVisibility requires "id".'),
      visibility: required(p.visibility, "skill setVisibility requires visibility."),
    }),
} satisfies Record<SkillAction, (p: SkillParams) => Promise<unknown>>;

export async function handleSkill(params: SkillParams) {
  return SKILL_ACTIONS[params.action](params);
}

// ---------- Workspace members ----------

export type MembersAction = "list" | "setRole" | "remove";

export type MembersParams = {
  client: BapApiClient;
  action: MembersAction;
  workspaceId: string;
  email?: string;
  role?: "admin" | "member";
};

const MEMBERS_ACTIONS = {
  list: (p: MembersParams) =>
    handleMembersList({ client: p.client, workspaceId: p.workspaceId }),
  setRole: (p: MembersParams) =>
    handleMembersSetRole({
      client: p.client,
      workspaceId: p.workspaceId,
      email: required(p.email, 'members setRole requires "email".'),
      role: required(p.role, 'members setRole requires "role".'),
    }),
  remove: (p: MembersParams) =>
    handleMembersRemove({
      client: p.client,
      workspaceId: p.workspaceId,
      email: required(p.email, 'members remove requires "email".'),
    }),
} satisfies Record<MembersAction, (p: MembersParams) => Promise<unknown>>;

export async function handleMembers(params: MembersParams) {
  return MEMBERS_ACTIONS[params.action](params);
}
