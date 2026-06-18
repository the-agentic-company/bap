/**
 * E2B sandbox driver.
 *
 * This file is a thin barrel that preserves the public import path
 * `@bap/core/server/sandbox/e2b`. The implementation lives in focused deep
 * modules under `./e2b/`:
 *   - `e2b/runtime.ts`      shared E2B/runtime-state plumbing
 *   - `e2b/provisioning.ts` turn a config into a running sandbox + client
 *   - `e2b/session.ts`      turn a sandbox into a ready OpenCode session
 *   - `e2b/admin.ts`        fleet operations (kill / list / configured?)
 *   - `e2b/backend.ts`      the SandboxBackend adapter
 */

export type { SandboxConfig } from "./e2b/runtime";
export { getOrCreateBareSandbox, getSandboxStateDurable } from "./e2b/provisioning";
export { getOrCreateSession, injectProviderAuth } from "./e2b/session";
export { isE2BConfigured, killSandbox, listAllE2BSandboxes, killE2BSandboxById } from "./e2b/admin";
export { E2BSandboxBackend } from "./e2b/backend";
