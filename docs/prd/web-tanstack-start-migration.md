# Migrate Web from Next.js to TanStack Start

Suggested Linear label/status: `ready-for-agent`

## Problem Statement

CmdClaw's web app currently runs on Next.js App Router, but the desired long-term direction is TanStack Start on Vite. The migration is not just a package swap: the web app contains public marketing pages, authenticated product routes, Better Auth flows, oRPC APIs, OAuth callbacks, webhook endpoints, binary download relays, service worker assets, Render deployment configuration, and live CLI/E2E workflows that all depend on the current URL contract.

The problem is to move the web runtime to TanStack Start without preserving Next.js as a hidden compatibility layer, while keeping existing user, operator, CLI, OAuth, and deployment behavior intact.

## Solution

Perform one ambitious Big Bang refactor of the web app from Next.js to TanStack Start on Vite. Replace the Next App Router tree with a TanStack Start route tree, move page shells and route protection into TanStack route layout boundaries, migrate API endpoints into TanStack server routes with framework-neutral handler modules, and update deployment to run the TanStack/Nitro Node output on Render.

The migration should align with TanStack Start best practices for v1 rather than emulating Next.js. The public URL contract, auth/OAuth endpoints, oRPC behavior, React Compiler support, local dev ports, Render host, service worker asset, and public environment variable names must remain stable.

## User Stories

1. As a CmdClaw User, I want the web app URLs I already use to keep working, so that the framework migration is invisible to my daily workflow.
2. As a CmdClaw User, I want public pages such as landing, pricing, legal, support, templates, shared conversations, and magic-link sign-in pages to keep rendering correctly, so that onboarding and external links do not break.
3. As an authenticated User, I want protected pages to redirect me to login when my session is missing, so that access control stays consistent.
4. As an authenticated User, I want successful login to return me to the page I originally requested, so that protected route redirects remain ergonomic.
5. As a User in a local worktree, I want dev auto-login behavior to keep working, so that browser testing stays fast.
6. As a self-hosted operator, I want self-hosted auth and instance routes to keep working, so that the deployment can still be administered.
7. As a cloud operator, I want cloud support-admin routes to remain restricted to support admins, so that admin surfaces do not become client-side-only protected.
8. As an admin User, I want admin navigation and pages to keep working after refresh and deep links, so that admin workflows survive the route migration.
9. As a User, I want chat and coworker routes to keep their current URL behavior, so that existing links and history entries remain valid.
10. As a User, I want query-string-driven UI states such as selected tabs, OAuth completion flags, modal preview IDs, and callback URLs to remain valid, so that current browser links still work.
11. As a User, I want images, logos, icons, favicons, manifest, and root static assets to continue loading, so that the app does not visually regress.
12. As a User with browser push enabled, I want the service worker and notification click targets to keep working, so that task notifications still open the app.
13. As a CLI user, I want device auth and CLI live flows to continue working against the web app, so that command-line usage is not disrupted.
14. As an MCP gateway user, I want hosted MCP OAuth endpoints to keep their current paths and behavior, so that external MCP clients remain compatible.
15. As an OAuth integration user, I want provider callback URLs to stay stable, so that provider dashboards do not need to be reconfigured for this migration.
16. As a Slack user, I want Slack link and event endpoints to keep working, so that Slack workflows and signatures do not break.
17. As a User downloading files, I want Modulr and coworker document downloads to preserve body bytes, MIME type, filenames, content disposition, and cache behavior, so that downloaded files remain reliable.
18. As a User submitting a bug report with an attachment, I want multipart upload behavior to keep working, so that support reports still include files.
19. As an operator, I want raw webhook body handling to remain correct, so that signed webhook verification remains safe.
20. As an operator, I want observability initialization to continue for the web service in production, so that logs, metrics, and traces do not disappear during the migration.
21. As an operator, I want Render deployment to keep hosting the web service, so that the framework migration does not become an infrastructure migration.
22. As an operator, I want the production process to bind to Render's configured port, so that deployed web services start correctly.
23. As a developer, I want local web dev to keep using port `3000`, so that existing CLI defaults and e2e scripts keep working.
24. As a developer, I want self-host local web dev to keep using port `3001`, so that the current self-host dev workflow remains recognizable.
25. As a developer, I want the route tree to use TanStack Start file routing, so that future route work follows the framework's native model.
26. As a developer, I want protected route groups to use route-level guards, so that auth logic is explicit at the route boundary.
27. As a developer, I want page shells to be pathless route layouts, so that shell selection is not a global pathname switch.
28. As a developer, I want substantial HTTP endpoint logic extracted behind standard `Request -> Response` handlers, so that route adapters stay thin and handlers remain testable.
29. As a developer, I want oRPC to remain the primary product API layer, so that this migration does not become a data-layer rewrite.
30. As a developer, I want TanStack route loaders to be used selectively, so that v1 gets routing benefits without moving every product query out of oRPC and React Query.
31. As a developer, I want TanStack Router's SSR Query integration wired in, so that query hydration and route prefetching have the correct future foundation.
32. As a developer, I want React Compiler to remain enabled, so that moving away from Next.js does not silently drop a critical compiler/performance setting.
33. As a developer, I want existing public environment variable names to remain valid, so that deployment and shared packages do not need a second env migration.
34. As a developer, I want Next-specific imports, configuration, and lint integration removed, so that the app is genuinely TanStack Start rather than a compatibility hybrid.
35. As a developer, I want route search params validated at the route boundary where they matter, so that search state becomes typed and explicit.
36. As a developer, I want metadata migrated to route-level head definitions, so that SEO concerns stay route-owned in TanStack Router.
37. As a developer, I want generated route tree output committed but treated as generated, so that clean checkouts typecheck without humans editing generated files.
38. As a reviewer, I want the Big Bang PR split into organized commits, so that the migration can be reviewed by layer without pretending two frameworks are supported.
39. As a reviewer, I want high-risk endpoints covered by focused tests, so that regressions in raw bodies, binary responses, CORS, and streaming are visible.
40. As a maintainer, I want stale docs updated only where they would mislead, so that operational documentation matches the new framework without unrelated rewrite churn.

## Implementation Decisions

- Follow ADR-0011, **Migrate Web from Next.js to TanStack Start**.
- Perform one Big Bang web migration PR. Do not support a dual Next/TanStack runtime.
- Keep the PR organized into reviewable commits by layer: TanStack shell, auth and route guards, API routes, page routes, assets/navigation, build/deployment, Next removal, and tests.
- Replace the Next App Router tree with a single TanStack Start route tree under the web app's route directory.
- Remove or fully replace the existing Next route tree once the migration is complete.
- Use TanStack Start file-based routing and commit the generated route tree file. Treat the generated file as generated output for lint/format noise.
- Keep non-route helpers, components, server modules, oRPC modules, and shared UI outside the route tree unless they are intentionally route-local.
- Use TanStack pathless layout routes for major shells: marketing/public shell, app shell, onboarding shell, settings shell, admin/support-admin shell, self-host instance shell, chat/agents/toolbox shells, and other existing layout boundaries.
- Keep the root route focused on HTML structure, global providers, global CSS, shared head defaults, and root error/not-found boundaries.
- Move protected page auth to TanStack route `beforeLoad` guards rather than a recreated global Next proxy.
- Model route access levels explicitly: general protected session routes, support-admin/cloud routes, and self-host instance routes.
- Keep API and oRPC authorization inside endpoint handlers. Page route guards must not be treated as API authorization.
- Remove the old injected `x-cmdclaw-pathname` and `x-cmdclaw-return-path` header contract. Derive pathname and search from TanStack route location or standard `Request` objects.
- Keep request-aware origin handling for Render/internal host normalization, because that solves a real host problem independent of Next.js.
- Keep Better Auth as the authentication system.
- Replace Better Auth's Next integration with the TanStack Start integration, including TanStack Start cookies as the final auth plugin.
- Mount Better Auth under the same public auth API paths and preserve device auth, password start, native callback, provider callbacks, and social callback behavior.
- Keep oRPC as the primary product API layer.
- Preserve `/api/rpc` behavior, supported HTTP methods, no-store headers, 401 behavior, streaming behavior, and current logging/metrics behavior.
- Use TanStack server routes for API endpoints under the TanStack route tree, preserving exact public URL paths.
- Extract substantial endpoint logic into framework-neutral HTTP handler modules grouped by public URL area. Route files should be thin adapters.
- Use standard `Request`, `Response`, `Headers`, `FormData`, streams, and Web APIs in extracted handlers.
- Keep trivial endpoints inline only when the route file remains genuinely small.
- Treat auth/OAuth callback paths as hard compatibility contracts. This includes Better Auth paths, device auth, provider callbacks, native callback, OAuth callback, hosted MCP OAuth, control-plane endpoints, Slack endpoints, dev auto-login/worktree auth, and magic-link sign-in paths.
- Use TanStack route loaders selectively for auth gates, redirects, params/search validation, dynamic metadata/head data, and small SSR-critical bootstrap data.
- Do not move ongoing product data fetching wholesale from oRPC/React Query into loaders in v1.
- Adopt TanStack Router's SSR Query integration and create the React Query client in the TanStack router/context shape.
- Preserve the existing React Query defaults and session-principal cache clearing behavior.
- Use route-level `validateSearch` for search params that affect behavior, including callback URLs, auto-login, selected tabs, OAuth result flags, modal preview IDs, filters, and auth completion flags.
- Migrate static and dynamic metadata to TanStack route `head` definitions. Use loaders only when dynamic head data requires server work.
- Replace `next/link` and `next/navigation` directly with TanStack Router primitives. Do not add Next compatibility wrappers.
- Replace `next/image` with platform-native image handling, mostly plain image elements with explicit dimensions, loading, and decoding. Add a small app image primitive only where repeated behavior is real.
- Replace `next/font` with Vite-compatible font loading, such as local font assets or fontsource packages.
- Move global CSS to a framework-neutral style location and import it from the TanStack app root.
- Keep Tailwind v4, the existing PostCSS setup, animation CSS, and typography plugin.
- Replace the old font CSS variables with the new Vite-compatible font variables so Tailwind's sans and mono font tokens continue to resolve.
- Keep `NEXT_PUBLIC_*` public environment variable names valid in v1.
- Configure Vite to expose only `VITE_*` and `NEXT_PUBLIC_*` client env prefixes. Do not expose unprefixed server env vars to client code.
- Replace the shared env validator's Next-specific package with a framework-neutral validator while preserving the exported `env` object and current variable names.
- Keep React Compiler enabled in the Vite/TanStack Start build. This is a critical migration requirement.
- Add a narrow TanStack Start `start` middleware entry for request-wide concerns only: server-function CSRF, security headers, and lightweight request/observability concerns if needed.
- Explicitly include TanStack's server-function CSRF middleware if a custom start middleware entry is defined.
- Do not put page auth routing into global middleware.
- Preserve web observability startup by explicitly initializing the web observability runtime from server startup code in production Node runtime.
- Keep development observability behavior gated the same way as today unless intentionally changed.
- Use TanStack root and route-level error/not-found boundaries. Keep v1 minimal: root boundaries plus route-specific not-found behavior for detail pages that already have user-facing not-found states.
- Keep `public` as the source of truth for static files: icons, logos, integration SVGs, manifest, service worker, and well-known assets.
- Keep dynamic `robots.txt` as a server route because it depends on app configuration.
- Keep `/sw.js` served from the root path and preserve browser push registration behavior.
- Keep local web dev on port `3000` and self-host local web dev on port `3001`.
- Update Render and Docker to build the TanStack Start app and run the TanStack/Nitro Node server output.
- Update build cache/output configuration away from Next's `.next` output.
- Remove Next-only dependencies, config files, generated env files, Next TypeScript plugin config, Next lint integration, and Next output references once the TanStack app builds.
- Keep existing `"use client"` directives in v1 unless they become invalid or directly noisy. Removing those directives is not part of the migration goal.
- Update docs that would otherwise become actively misleading, including web app instructions, README framework references, worktree docs, testing quarantine paths, Render/Docker references, and Next-specific operational wording.

## Testing Decisions

- Tests should assert externally visible behavior and compatibility contracts. Do not duplicate router implementation details in tests.
- The migration is not done until the web app passes `bun run check`.
- The migration is not done until the web app passes `bun run test`.
- The migration is not done until `bun run --cwd apps/web test:e2e:cli:live` passes.
- The migration is not done until root `bun run test:ci` passes.
- The migration is not done until the web build command produces TanStack/Nitro output.
- The migration is not done until the built web server starts locally from the production output and serves key routes.
- Add or preserve route smoke coverage for public pages, protected redirects, login, invite-only, magic-link sign-in, shared conversation pages, templates, legal/support pages, and key authenticated app pages.
- Add or preserve route smoke coverage for `/api/auth`, `/api/rpc`, key OAuth callbacks, hosted MCP OAuth endpoints, control-plane callbacks, Slack endpoints, dev auto-login/worktree auth, and magic-link confirm/resend routes.
- Add or preserve focused handler tests for extracted `Request -> Response` HTTP handlers.
- Convert tests that instantiate Next request/response objects to standard Web `Request` and `Response` tests.
- Remove component test mocks for `next/link`, `next/navigation`, and `next/image`. Replace with TanStack Router testing utilities or targeted mocks only where needed.
- Test auth route guards at the route behavior level: unauthenticated protected routes redirect, authenticated protected routes render, support-admin routes reject non-admin users, self-host-only routes redirect in cloud, and cloud-only admin routes redirect in self-host.
- Test route search validation for high-impact search params such as callback URLs, auto-login, OAuth completion flags, selected tabs, modal preview IDs, and filters.
- Test that oRPC route behavior preserves no-store headers, streaming support, 401 login behavior, and HTTP method support.
- Test raw body preservation for signed webhook handlers, especially Slack and Resend.
- Test binary and download endpoints for exact body bytes, MIME type, content disposition, content length, and no-store/private cache headers.
- Test multipart bug report handling with and without attachments.
- Test hosted MCP OAuth CORS/options behavior.
- Smoke test static assets: logo, icons/manifest, well-known Microsoft identity association, service worker, and robots text.
- Smoke test browser push registration enough to prove `/sw.js` is still reachable and notification click target paths remain valid.
- Test observability startup through a small import/bootstrap check so the web runtime cannot silently drop telemetry initialization.
- Verify React Compiler remains configured in the Vite/TanStack build.
- Keep broader e2e coverage focused on proving the Big Bang cutover works. Do not rewrite every page test unless needed for behavior coverage.
- Use the existing web route tests, API route tests, oRPC tests, e2e live scripts, CLI live tests, and smoke-stable scripts as prior art.

## Out of Scope

- Product redesign or navigation redesign.
- Changing the public URL contract.
- Renaming public environment variables from `NEXT_PUBLIC_*` to `VITE_*` in v1.
- Replacing Better Auth.
- Replacing oRPC as the primary product API layer.
- Rewriting all product data fetching into TanStack route loaders.
- Introducing React Server Components.
- Adding a dual Next/TanStack runtime.
- Adding compatibility wrappers that preserve Next.js routing, image, or navigation semantics.
- Keeping `src/app` as an active route tree after the cutover.
- Changing Render as the production host.
- Changing local dev default ports.
- Rewriting service worker or push-notification behavior beyond smoke validation.
- Removing all `"use client"` directives as cleanup.
- Broad lint-rule changes unrelated to removing Next integration and generated route-tree noise.
- Broad test-suite redesign beyond what is needed to preserve the migration contracts.

## Further Notes

This document is an engineering migration spec, not a product feature PRD. The user-facing goal is continuity: CmdClaw should feel like the same product while the framework foundation changes.

ADR-0011 records the architectural rationale. This spec records the preservation contracts, implementation boundaries, and acceptance gates required for another agent or reviewer to execute the Big Bang migration.

The acceptance bar is intentionally high because this migration changes the web framework, route system, build output, server runtime, auth integration, deployment command, and test surface at the same time.
