export type McpServerSlug = "bap" | "gmail" | "galien" | "modulr";

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
  bap: {
    slug: "bap",
    name: "Bap MCP",
    publicBasePath: "/bap",
    internalTargetEnvVar: "CMDCLAW_BAP_MCP_TARGET",
    authStrategy: "oauth",
    childRoot: "servers/cmdclaw",
    installMetadata: {
      title: "Bap MCP",
      description: "Bap app tools",
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
      description: "Read, search, draft, and send Gmail messages through Bap",
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

export function getMcpServerDefinitionByPublicBasePath(
  publicBasePath: string,
): McpServerDefinition | null {
  const normalized = `/${publicBasePath.split("/").filter(Boolean)[0] ?? ""}`;
  return (
    Object.values(MCP_SERVER_REGISTRY).find((server) => server.publicBasePath === normalized) ??
    null
  );
}

function buildMcpPublicUrl(baseUrl: string, slug: McpServerSlug, path = ""): string {
  return new URL(`${MCP_SERVER_REGISTRY[slug].publicBasePath}${path}`, baseUrl).toString();
}

export function buildProtectedResourceMetadataPath(
  slug: McpServerSlug,
): `/.well-known/oauth-protected-resource/${string}` {
  const publicSlug = MCP_SERVER_REGISTRY[slug].publicBasePath.split("/").filter(Boolean)[0] ?? slug;
  return `/.well-known/oauth-protected-resource/${publicSlug}`;
}
