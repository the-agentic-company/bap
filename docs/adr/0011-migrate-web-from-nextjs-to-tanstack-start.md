# Migrate Web from Next.js to TanStack Start

CmdClaw will migrate `apps/web` from Next.js to TanStack Start on Vite as a Big Bang refactor, replacing the Next App Router tree with a single TanStack route tree in `apps/web/src/routes`. We will keep the public URL and API contract stable, keep Render as the production host, and run the TanStack Start Node/Nitro output instead of `next start`.

The migration should align with TanStack Start's model rather than preserving Next semantics. Route ownership moves to file-based TanStack routes, shells become pathless layout routes, protected page groups use route `beforeLoad` auth gates, metadata moves to route `head`, and app-level 404/error behavior uses TanStack route boundaries. We will not add compatibility wrappers for `next/link`, `next/navigation`, `next/image`, or Next route handlers; call sites should move directly to TanStack Router, platform-native assets, and standard `Request`/`Response` handlers.

This is intentionally not a full data-layer rewrite. Better Auth remains the auth system with its TanStack Start cookie integration, and oRPC remains the primary product API layer. TanStack loaders and server functions should be used selectively for route-local concerns such as auth gates, redirects, search/param validation, dynamic head data, and small SSR-critical bootstrap data.

The cutover must preserve current deployment and performance contracts that are independent of Next.js. React Compiler remains enabled in the Vite/TanStack build, and existing `VITE_*` public environment variable names remain valid in v1 through Vite's env prefix configuration rather than being renamed during the framework migration.

We considered a lower-risk dual-runtime or compatibility-wrapper migration, but rejected it because it would leave the app with two routing mental models and make it harder to adopt TanStack Router's typed routes, search params, route context, and layout boundaries. The accepted trade-off is a larger v1 refactor in exchange for a cleaner long-term framework shape.
