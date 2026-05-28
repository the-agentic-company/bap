# Make Web App the Canonical Modulr Download Relay

Suggested Linear label/status: `ready-for-agent`

## Problem Statement

When an agent downloads a **Modulr Customer Document**, CmdClaw currently creates a short-lived stored file and returns a download URL hosted by the MCP gateway. In production, this made the runtime path brittle: the externally hosted runtime sandbox and the **User** should only need to reach the canonical CmdClaw app host, while object storage remains private infrastructure reachable only by CmdClaw services.

## Solution

Make the web app host (`cmdclaw.ai` in production, `staging.cmdclaw.ai` in staging, and the configured app URL locally) the canonical public relay for every **Modulr Download Artifact**. The Modulr MCP tool will continue to fetch the document from Modulr and create the short-lived artifact in private object storage, but it will return an app-hosted download URL. The web app route will verify the signed short-lived token, enforce that the storage key matches the claimed workspace scope, read the artifact from private object storage, and stream it to the caller.

## User Stories

1. As a User, I want Modulr document download links to use `cmdclaw.ai`, so that downloaded files come from the product host I already trust.
2. As a User, I want staging Modulr document download links to use `staging.cmdclaw.ai`, so that staging behavior matches the deployed staging app.
3. As a User, I want local or worktree Modulr document download links to use the configured app URL, so that local testing exercises the same boundary as production.
4. As a User, I want a Modulr document download link returned by the assistant to open directly, so that I can retrieve the file without knowing about MCP infrastructure.
5. As a User, I want downloaded Modulr documents to preserve their filename and MIME type, so that my operating system opens them correctly.
6. As a User, I want download links to remain short-lived, so that shared links do not stay valid indefinitely.
7. As a support agent, I want `modulr.download_document` to keep downloading the selected **Modulr Customer Document**, so that existing agent workflows still work.
8. As a support agent, I want `modulr.download_document` to return a direct app-hosted URL, so that I do not need to manually transform MCP-hosted URLs.
9. As a support agent, I want the tool result to include document title, filename, MIME type, size, resource URI, and download URL, so that I can report what was downloaded.
10. As a support agent, I do not want the tool result to expose private object-storage keys, so that implementation details do not become part of the agent-facing contract.
11. As a runtime sandbox, I want to fetch downloads only from the CmdClaw app host, so that I do not require direct access to private object storage.
12. As a runtime sandbox, I want returned URLs to avoid MCP infrastructure hosts, so that allowlists can focus on the canonical app host.
13. As an operator, I want the MCP server to keep creating **Modulr Download Artifacts**, so that Modulr access and private object-storage writes stay inside CmdClaw infrastructure.
14. As an operator, I want the web app to own the public download relay, so that user-facing file serving is centralized.
15. As an operator, I want the MCP gateway to stop serving Modulr download routes, so that there is only one public relay boundary.
16. As an operator, I want signed tokens to carry the storage locator opaquely, so that the web app can stream the artifact without a database lookup.
17. As an operator, I want the web app to reject tokens whose storage key does not match the claimed workspace scope, so that malformed or inconsistent tokens cannot cross workspace boundaries.
18. As an operator, I want token-only authorization to remain supported, so that assistant-rendered links can be opened directly by browsers and download managers.
19. As an operator, I want token validation to keep enforcing expiry and signature checks, so that the route remains safe without requiring a logged-in session.
20. As a developer, I want `APP_URL` or the equivalent configured app URL to determine the download host, so that MCP and app host concerns do not get mixed.
21. As a developer, I want `CMDCLAW_MCP_BASE_URL` to remain only the MCP endpoint host, so that source registration and download relay concerns stay separate.
22. As a developer, I want the web download route to keep streaming from private object storage, so that the behavior remains compatible with existing **Modulr Download Artifacts**.
23. As a developer, I want the shared Modulr download token contract to stay small and explicit, so that both the MCP tool and web route can be tested in isolation.
24. As a developer, I want the MCP gateway duplicate download code removed, so that future changes do not drift between gateway and web implementations.
25. As a developer, I want `modulr.get_document` and MCP resource behavior to remain unchanged, so that the **Modulr Document Resource** use case is not mixed with user-facing downloads.
26. As a developer, I want focused tests around URL construction, web relay behavior, and token scope validation, so that the regression is locked down without broad e2e cost.
27. As a maintainer, I want the implementation to respect ADR-0007, so that the public relay boundary is clear to future contributors.

## Implementation Decisions

- The web app is the canonical public relay for **Modulr Download Artifacts**.
- The Modulr MCP server remains responsible for fetching bytes from Modulr and writing the short-lived artifact to private object storage during `modulr.download_document`.
- The MCP tool builds the returned download URL from the configured app URL, not the MCP base URL.
- The production URL must resolve under `cmdclaw.ai`; the staging URL must resolve under `staging.cmdclaw.ai`; local and worktree environments use the configured app URL with the existing public callback fallback behavior where needed.
- The MCP gateway no longer exposes the Modulr document download route.
- The web app download route remains token-only and does not require a logged-in web session.
- The signed token remains shared between MCP and web and includes safe routing metadata: storage key, filename, MIME type, workspace id, document id, size, and expiry.
- The signed token remains opaque to the caller; the MCP tool result no longer exposes the private storage key in structured output.
- The web app route verifies the signature, expiry, required claims, and that the storage key is scoped under the claimed workspace prefix.
- The web app route streams the object-storage bytes with the existing content type, content disposition, content length, and no-store cache behavior.
- The object-storage dependency remains private infrastructure and is never exposed directly to the runtime sandbox or User.
- `modulr.get_document` and `modulr://documents/{documentId}` resource behavior stay unchanged.
- No schema changes are required.
- No new long-lived artifact record is required for this slice; the signed token is sufficient to locate the short-lived object-storage artifact.
- ADR-0007 records the architectural decision that the web app owns the Modulr download relay.

## Testing Decisions

- Tests should assert externally visible behavior rather than duplicating implementation details.
- Test that `modulr.download_document` returns an app-hosted `/api/modulr/documents/download` URL even when an MCP base URL is configured.
- Test that the returned structured content includes document metadata and download URL, but not the private object-storage key.
- Test that the web app download route accepts a valid signed token and streams bytes from private object storage with the expected headers.
- Test that the web app download route rejects missing, invalid, expired, or malformed tokens.
- Test that the web app download route rejects a token whose storage key is not scoped under `modulr-documents/{workspaceId}/...`.
- Test that the MCP gateway no longer handles `GET /modulr/documents/download`.
- Use existing Modulr MCP tool tests, web API route tests, gateway route tests, and token utility tests as prior art.

## Out of Scope

- Replacing object storage with click-time Modulr fetching.
- Removing storage of **Modulr Download Artifacts**.
- Adding session-based authorization to the download route.
- Changing `modulr.get_document` or MCP resource behavior.
- Creating, updating, deleting, or uploading Modulr documents in Modulr.
- Changing Modulr Workspace Connection authentication.
- Fixing unrelated prod S3 environment or connectivity drift, except where required to verify this feature.
- Changing lint rules or lint configuration.

## Further Notes

The root-cause investigation found the production failure inside the MCP service storage step: the Modulr document list succeeded, but `modulr.download_document` failed during object-storage bucket access before returning a usable link. This PRD preserves the current “fetch and store during the tool call” behavior while moving the public download relay to the canonical app host.

The domain glossary now defines **Modulr Download Artifact**, and ADR-0007 records the web-app relay ownership decision.
