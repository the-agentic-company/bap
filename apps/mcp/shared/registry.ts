export type McpServerSlug = "internal" | "gmail" | "galien" | "modulr";

export type McpServerDefinition = {
  slug: McpServerSlug;
  name: string;
  publicBasePath: `/${string}`;
  internalTargetEnvVar: string;
  authStrategy: "oauth" | "managed_bearer";
  childRoot: string;
  installMetadata: {
    title: string;
    description: string;
  };
};

export const MCP_SERVER_REGISTRY: Record<McpServerSlug, McpServerDefinition> = {
  internal: {
    slug: "internal",
    name: "CmdClaw Internal MCP",
    publicBasePath: "/internal",
    internalTargetEnvVar: "CMDCLAW_INTERNAL_MCP_TARGET",
    authStrategy: "oauth",
    childRoot: "servers/internal",
    installMetadata: {
      title: "Internal MCP",
      description: "CmdClaw internal app tools",
    },
  },
  gmail: {
    slug: "gmail",
    name: "Gmail MCP",
    publicBasePath: "/gmail",
    internalTargetEnvVar: "CMDCLAW_GMAIL_MCP_TARGET",
    authStrategy: "oauth",
    childRoot: "servers/gmail",
    installMetadata: {
      title: "Gmail MCP Server",
      description: "Read, search, draft, and send Gmail messages through CmdClaw",
    },
  },
  galien: {
    slug: "galien",
    name: "Galien MCP",
    publicBasePath: "/galien",
    internalTargetEnvVar: "CMDCLAW_GALIEN_MCP_TARGET",
    authStrategy: "oauth",
    childRoot: "servers/galien",
    installMetadata: {
      title: "Galien MCP Server",
      description: "Query the Galien CRM API and create visit reports",
    },
  },
  modulr: {
    slug: "modulr",
    name: "Modulr MCP",
    publicBasePath: "/modulr",
    internalTargetEnvVar: "CMDCLAW_MODULR_MCP_TARGET",
    authStrategy: "oauth",
    childRoot: "servers/modulr",
    installMetadata: {
      title: "Modulr MCP Server",
      description: "Find Modulr customer records and attached GED documents",
    },
  },
};

export function getMcpServerDefinition(slug: string): McpServerDefinition | null {
  return MCP_SERVER_REGISTRY[slug as McpServerSlug] ?? null;
}

function buildMcpPublicUrl(baseUrl: string, slug: McpServerSlug, path = "/mcp"): string {
  return new URL(`${MCP_SERVER_REGISTRY[slug].publicBasePath}${path}`, baseUrl).toString();
}

export function buildProtectedResourceMetadataPath(slug: McpServerSlug): `/.well-known/oauth-protected-resource/${string}/mcp` {
  return `/.well-known/oauth-protected-resource/${slug}/mcp`;
}
