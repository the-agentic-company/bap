# Add Modulr MCP for Modulr Customer Document Context

Suggested Linear label/status: `ready-for-agent`

## Problem Statement

When a customer's team receives an email from one of their own customers, the agent needs quick context from Modulr: identify the matching **Modulr Customer** by sender email, list current **Modulr Customer Documents**, optionally expand to related **Modulr Customer Records**, and download selected documents for inspection.

## Solution

Build a hosted MCP server named `modulr`. It will use a workspace-owned **Modulr Workspace Connection**, derive short-lived bearer tokens at runtime, and expose read-only tools plus an MCP resource for document bytes.

## User Stories

1. As a support agent, I want to find a Modulr Customer from an inbound email address, so that I can answer with the right customer context.
2. As a support agent, I want documents directly attached to that Modulr Customer, so that I can see the customer's current GED attachments.
3. As a support agent, I want ambiguous email matches to return candidates instead of guessing, so that documents are not pulled from the wrong customer.
4. As a support agent, I want to list related policies, estimates, claims, and complaints, so that I can deliberately expand beyond customer-level documents.
5. As a support agent, I want to list documents for selected records, so that I can inspect policy, claim, estimate, or complaint attachments only when relevant.
6. As a support agent, I want to download one selected document through MCP resources, so that large files are transferred only on demand.
7. As a workspace admin, I want to configure Modulr database, client id, client secret, locale, and base URL, so that the MCP can authenticate without per-user Modulr credentials.
8. As an operator, I want bearer tokens derived at runtime and not persisted, so that expiring credentials are not stored.

## Implementation Decisions

- Add MCP slug and namespace `modulr`.
- Add a workspace-owned Modulr connection flow; do not create per-user Modulr credentials.
- Store long-lived connection inputs only: `database`, `clientId`, encrypted `clientSecret`, `locale` defaulting to `fr`, and `baseUrl` defaulting to `https://app.modulr-courtage.fr`.
- Derive bearer tokens at runtime via `POST /{locale}/api/1.0/tokens/users`.
- A read-only probe confirmed this auth shape:
  - `Database: assurhelium`
  - `client_id: api`
  - response includes `access_token`, `token_type: Bearer`, and `expires_in: 3600`
- Implement a deep Modulr client module that owns auth, token caching, search requests, GED tag resolution, document metadata parsing, and document content fetch.
- Use exact `equal` matching for email fields. First search customer `email` and `email_2`, then contact `email` and `email_2`, then contact associations to `client_id`.
- Return ambiguity candidates and require disambiguation when multiple Modulr Customers match.
- Default document listing returns all GED documents; support `extranetOnly` by adding the system `extranet` tag filter.
- Expose four read-only tools:
  - `modulr.list_customer_documents_by_email`
  - `modulr.list_customer_records`
  - `modulr.list_documents_for_records`
  - `modulr.get_document`
- Expose resource `modulr://documents/{documentId}`.
- `modulr.get_document` returns a `resource_link`; `resources/read` returns text or a base64 blob with MIME metadata.
- Use the Modulr document guide for GED classification behavior: `https://doc.modulr-courtage.fr/guide/gestion-des-documents`.
- Use the Modulr search filter guide for search payload shape: `https://doc.modulr-courtage.fr/guide/filtres-de-recherche-api`.

## Testing Decisions

- Test external behavior, not duplicated Modulr internals.
- Unit test Modulr client auth, token derivation, exact search payloads, ambiguity handling, GED tag lookup, and document resource reads using fetch mocks or MSW.
- Test MCP tools for successful customer match, no match, ambiguous match, direct documents, record expansion, and resource link output.
- Test admin/API connection validation with encrypted credential persistence and failed auth handling.
- Use existing MCP server tests, Galien service tests, workspace executor source tests, and MSW-style HTTP tests in core as prior art.

## Out of Scope

- Creating, updating, deleting, or uploading Modulr documents.
- Broad raw Modulr API tools.
- Fuzzy or `like` email matching.
- Automatic expansion to every Modulr entity type.
- Persisting Modulr bearer tokens.
- Per-user Modulr OAuth or Account Labels.

## Further Notes

`CONTEXT.md` was updated with Modulr domain language: **Modulr Customer**, **Modulr Customer Email Match**, **Modulr Customer Record**, **Modulr Customer Document**, **Modulr Document Resource**, and **Modulr Workspace Connection**.
