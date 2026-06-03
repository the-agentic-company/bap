import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
// Validate environment variables at config load (mirrors the old next.config.ts side effect).
import * as envConfig from "./src/env.js";

void envConfig;

// Resolve the `@/*` -> `src/*` alias directly here rather than scanning every workspace
// tsconfig (vite-tsconfig-paths trips over the monorepo's extended base configs).
const srcDir = fileURLToPath(new URL("./src", import.meta.url));

const SELF_HOST_PORT = 3001;
const DEFAULT_PORT = 3000;

// Self-host dev runs on 3001 via `dev:selfhost`, everything else stays on 3000.
const devPort = process.env.CMDCLAW_EDITION === "selfhost" ? SELF_HOST_PORT : DEFAULT_PORT;

export default defineConfig({
  /**
   * Only expose client env vars under the `VITE_*` and `NEXT_PUBLIC_*` prefixes.
   * `NEXT_PUBLIC_*` is preserved for v1 of the migration; unprefixed server env vars
   * (DATABASE_URL, secrets, OAuth credentials, etc.) are never bundled to the client.
   */
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  resolve: {
    alias: {
      "@": srcDir,
    },
  },
  server: {
    port: devPort,
  },
  // Dev only: Vite's esbuild dep pre-bundling crawls from routes into the @cmdclaw/core
  // workspace source and hits server-only code that the production Rollup build externalizes
  // for SSR. Two failure modes to keep out of esbuild:
  //  1. @tanstack/start-server-core uses virtual `#tanstack-*` entries only the Vite plugin
  //     can resolve, so it must never be pre-bundled by esbuild.
  //  2. dockerode -> docker-modem -> ssh2 -> cpu-features ship native `.node` binaries that
  //     esbuild has no loader for; they must stay external (server-only sandbox code).
  optimizeDeps: {
    exclude: [
      "@tanstack/react-start",
      "@tanstack/start-server-core",
      "dockerode",
      "docker-modem",
      "ssh2",
      "cpu-features",
    ],
  },
  ssr: {
    external: ["dockerode", "docker-modem", "ssh2", "cpu-features"],
  },
  plugins: [
    // Nitro owns the production Node server output (`.output/server/index.mjs`), matching
    // the current TanStack Start starter shape.
    nitro({
      rollupConfig: {
        external: [/^dockerode$/, /^docker-modem$/, /^ssh2($|\/)/, /^cpu-features($|\/)/],
      },
    }),
    // TanStack Start: file-based routing (generates src/routeTree.gen.ts) and the SSR
    // server build consumed by Nitro.
    tanstackStart(),
    // We own @vitejs/plugin-react (TanStack Start does not bundle it), which is where
    // React Fast Refresh AND the React Compiler run. React Compiler MUST stay enabled in
    // the Vite build — this is a hard migration requirement.
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", {}]],
      },
    }),
  ],
});
