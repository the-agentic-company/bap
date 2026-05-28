# Web App Owns Modulr Download Relay

CmdClaw serves **Modulr Download Artifacts** through the web app host (`APP_URL`) rather than the MCP gateway, so the externally hosted runtime sandbox and the **User** receive normal `cmdclaw.ai` or `staging.cmdclaw.ai` download links without direct object-storage access. The Modulr MCP server still creates the short-lived artifact because it can access Modulr and CmdClaw private object storage, but the public relay boundary belongs to the app server and is authorized by a short-lived signed token whose storage key must match the claimed workspace scope.

**Considered Options**

- Serve downloads from the MCP gateway: keeps all Modulr behavior in one service, but exposes an infrastructure host as the user-facing download surface and duplicates relay behavior already present in the app.
- Fetch from Modulr only when the user clicks: avoids storing document bytes, but changes the existing tool semantics and makes browser downloads depend on click-time Modulr access.
- Serve app-hosted links backed by MCP-created artifacts: preserves current download behavior while keeping the sandbox and user on the canonical app host.

**Consequences**

The MCP gateway does not expose Modulr document download routes. New Modulr download links are app-hosted, and object storage remains a private infrastructure dependency used only by CmdClaw services.
