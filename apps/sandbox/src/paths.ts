import path from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const SANDBOX_APP_ROOT = path.resolve(THIS_DIR, "..");
export const SANDBOX_REPO_ROOT = path.resolve(SANDBOX_APP_ROOT, "../..");
export const SANDBOX_SRC_ROOT = THIS_DIR;
export const SANDBOX_TEMPLATE_ROOT = SANDBOX_SRC_ROOT;
export const SANDBOX_COMMON_ROOT = path.join(SANDBOX_SRC_ROOT, "common");
export const SANDBOX_SKILLS_ROOT = path.join(SANDBOX_COMMON_ROOT, "skills");
export const SANDBOX_DOCKER_RUNTIME_DOCKERFILE = path.join(
  SANDBOX_SRC_ROOT,
  "docker",
  "Dockerfile.runtime",
);
