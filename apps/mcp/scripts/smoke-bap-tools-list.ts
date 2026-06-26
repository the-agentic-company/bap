import { signHostedMcpAccessToken } from "@bap/core/server/hosted-mcp-oauth";

const DEFAULT_URL = "http://127.0.0.1:3010/bap";
const EXPECTED_TOOLS = [
  "workspace.list",
  "workspace.create",
  "workspace.switch",
  "workspace.addMembers",
  "coworker.moveWorkspace",
  "coworker.delete",
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

async function createSmokeToken(parsedUrl: URL) {
  const secret = process.env.APP_SERVER_SECRET?.trim();
  if (!secret) {
    throw new Error("APP_SERVER_SECRET must be set to mint the local smoke-test token.");
  }

  return signHostedMcpAccessToken({
    userId: "smoke-user",
    workspaceId: "smoke-workspace",
    allowedWorkspaceIds: ["smoke-workspace"],
    allowAllWorkspaces: false,
    audience: "bap",
    scope: ["bap"],
    clientId: "smoke-client",
    grantId: "smoke-grant",
    secret,
    issuer: parsedUrl.origin,
  });
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

async function fetchToolNames(parsedUrl: URL) {
  const token = await createSmokeToken(parsedUrl);

  const response = await fetch(parsedUrl, {
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

  const body = (await response.json()) as McpToolsListResponse;
  if (!response.ok) {
    throw new Error(
      `tools/list failed with HTTP ${response.status}: ${
        body.error?.message ?? JSON.stringify(body)
      }`,
    );
  }

  return getToolNames(body);
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

  if (missing.length === 0) {
    return;
  }

  console.error("\nMissing expected tools:");
  for (const toolName of missing) {
    console.error(`- ${toolName}`);
  }
  process.exit(1);
}

async function main() {
  const parsedUrl = new URL(parseUrlArg(process.argv.slice(2)));
  const toolNames = await fetchToolNames(parsedUrl);
  printToolNames(parsedUrl, toolNames);
  assertExpectedTools(toolNames);
  console.log("\nAll expected Bap workspace/coworker tools are present.");
}

await main();
