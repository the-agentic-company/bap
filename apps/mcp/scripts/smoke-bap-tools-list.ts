import { MANAGED_BAP_TOOL_PROFILES } from "@bap/core/server/managed-bap-capabilities";
import { signHostedMcpAccessToken } from "@bap/core/server/hosted-mcp-oauth";
import { signManagedMcpToken, type ManagedMcpSurface } from "@bap/core/server/managed-mcp-auth";

const DEFAULT_URL = "http://127.0.0.1:3010/bap";
const EXPECTED_TOOLS = [
  "attachment_completeUpload",
  "attachment_prepareUpload",
  "chat_run",
  "connectedAccount_connect",
  "connectedAccount_disconnect",
  "connectedAccount_read",
  "coworker_delete",
  "coworker_moveWorkspace",
  "coworker_read",
  "coworker_save",
  "coworkerDocument_delete",
  "coworkerDocument_save",
  "coworkerRun_cancel",
  "coworkerRun_read",
  "coworkerRun_resume",
  "coworkerRun_start",
  "runner_markFailed",
  "skill_delete",
  "skill_read",
  "skill_save",
  "workspace_list",
  "workspace_save",
  "workspaceMcpServer_delete",
  "workspaceMcpServer_list",
  "workspaceMcpServer_save",
  "workspaceMcpServer_setCredential",
  "workspaceMcpServer_startOAuth",
  "workspaceMember_list",
  "workspaceMember_remove",
  "workspaceMember_save",
] as const;
const REMOVED_TOOLS = [
  "workspace_switch",
  "workspace_create",
  "workspace_addMembers",
  "coworker_clone",
  "coworker_move",
  "coworker_setFavorite",
  "coworker_setStatus",
  "fileAsset_createUpload",
  "fileAsset_completeUpload",
  "workspaceMcpServer_revokeCredential",
] as const;

type McpToolsListResponse = {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: {
    tools?: Array<{
      name?: string;
      description?: string;
    }>;
  };
  error?: {
    code: number;
    message: string;
  };
};

function parseUrlArg(argv: string[]): string {
  const urlIndex = argv.findIndex((arg) => arg === "--url");
  if (urlIndex >= 0) {
    const value = argv[urlIndex + 1]?.trim();
    if (!value) {
      throw new Error("Missing value after --url");
    }
    return value;
  }

  return process.env.BAP_MCP_SMOKE_URL?.trim() || DEFAULT_URL;
}

function smokeSecret() {
  const secret = process.env.APP_SERVER_SECRET?.trim();
  if (!secret) {
    throw new Error("APP_SERVER_SECRET must be set to mint the local smoke-test token.");
  }
  return secret;
}

async function createSmokeToken(parsedUrl: URL) {
  return signHostedMcpAccessToken({
    userId: "smoke-user",
    workspaceId: "smoke-workspace",
    allowedWorkspaceIds: ["smoke-workspace"],
    allowAllWorkspaces: false,
    audience: "bap",
    scope: ["bap"],
    clientId: "smoke-client",
    grantId: "smoke-grant",
    secret: smokeSecret(),
    issuer: parsedUrl.origin,
  });
}

function createManagedSmokeToken(surface: ManagedMcpSurface) {
  return signManagedMcpToken(
    {
      userId: "smoke-user",
      workspaceId: "smoke-workspace",
      internalKey: "bap",
      surface,
      generationId: "smoke-generation",
      conversationId: "smoke-conversation",
      coworkerRunId: surface === "coworker_runner" ? "smoke-run" : undefined,
      spawnDepth: 0,
      exp: Math.floor(Date.now() / 1000) + 60,
    },
    smokeSecret(),
  );
}

function getToolNames(body: McpToolsListResponse) {
  return Array.from(
    new Set(
      (body.result?.tools ?? [])
        .map((tool) => tool.name?.trim() ?? "")
        .filter((name) => name.length > 0),
    ),
  ).sort();
}

async function requestToolList(parsedUrl: URL, token: string) {
  return fetch(parsedUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });
}

async function readToolListResponse(response: Response) {
  const body = (await response.json()) as McpToolsListResponse;
  if (!response.ok) {
    throw new Error(
      `tools/list failed with HTTP ${response.status}: ${
        body.error?.message ?? JSON.stringify(body)
      }`,
    );
  }

  return body;
}

function logManagedProfile(response: Response) {
  const managedProfile = response.headers.get("x-bap-mcp-profile");
  if (managedProfile) console.log(`Managed profile response: ${managedProfile}`);
}

async function fetchToolNames(parsedUrl: URL, token: string) {
  const response = await requestToolList(parsedUrl, token);
  const body = await readToolListResponse(response);
  logManagedProfile(response);
  return getToolNames(body);
}

function assertExactTools(label: string, actual: string[], expected: readonly string[]) {
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`${label} tools differ: ${JSON.stringify(actual)}`);
  }
}

function printToolNames(parsedUrl: URL, toolNames: string[]) {
  console.log(`MCP endpoint: ${parsedUrl.toString()}`);
  console.log(`Discovered tools: ${toolNames.length}`);
  for (const toolName of toolNames) {
    console.log(`- ${toolName}`);
  }
}

function assertExpectedTools(toolNames: string[]) {
  const missing = EXPECTED_TOOLS.filter((tool) => !toolNames.includes(tool));
  const unexpected = toolNames.filter(
    (tool) => !(EXPECTED_TOOLS as readonly string[]).includes(tool),
  );
  const unexpectedlyPresent = REMOVED_TOOLS.filter((tool) => toolNames.includes(tool));

  if (missing.length === 0 && unexpected.length === 0 && unexpectedlyPresent.length === 0) {
    return;
  }

  console.error("\nMissing expected tools:");
  for (const toolName of missing) {
    console.error(`- ${toolName}`);
  }
  if (unexpected.length > 0) {
    console.error("\nUnexpected tools:");
    for (const toolName of unexpected) {
      console.error(`- ${toolName}`);
    }
  }
  if (unexpectedlyPresent.length > 0) {
    console.error("\nRemoved tools still present:");
    for (const toolName of unexpectedlyPresent) {
      console.error(`- ${toolName}`);
    }
  }
  process.exit(1);
}

async function main() {
  const parsedUrl = new URL(parseUrlArg(process.argv.slice(2)));
  const toolNames = await fetchToolNames(parsedUrl, await createSmokeToken(parsedUrl));
  printToolNames(parsedUrl, toolNames);
  assertExpectedTools(toolNames);
  const chatTools = await fetchToolNames(parsedUrl, createManagedSmokeToken("chat"));
  const runnerTools = await fetchToolNames(parsedUrl, createManagedSmokeToken("coworker_runner"));
  assertExactTools("managed chat", chatTools, MANAGED_BAP_TOOL_PROFILES.chat);
  assertExactTools("managed runner", runnerTools, MANAGED_BAP_TOOL_PROFILES.coworker_runner);
  console.log("\nThe exact 30-tool Bap MCP contract is present.");
  console.log(`Managed chat profile: ${chatTools.length} tools.`);
  console.log(`Managed runner profile: ${runnerTools.join(", ")}.`);
}

await main();
