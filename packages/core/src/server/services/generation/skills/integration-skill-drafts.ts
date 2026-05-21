import type { SandboxBackend } from "../../../sandbox/types";
import { createCommunityIntegrationSkill } from "../../integration-skill-service";

const INTEGRATION_SKILL_DRAFTS_DIR = "/app/.opencode/integration-skill-drafts";

export async function importIntegrationSkillDraftsFromSandbox(input: {
  userId: string;
  sandbox: SandboxBackend;
  logDraftError?: (filePath: string, error: unknown) => void;
  logSkippedDraft?: (slug: string, error: unknown) => void;
}): Promise<void> {
  const findResult = await input.sandbox.execute(
    `find ${INTEGRATION_SKILL_DRAFTS_DIR} -maxdepth 1 -type f -name '*.json' 2>/dev/null | head -20`,
  );
  const paths = findResult.stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  await Promise.all(
    paths.map(async (filePath) => {
      try {
        const content = await input.sandbox.readFile(filePath);
        const created = await importIntegrationSkillDraftContent({
          userId: input.userId,
          rawContent: content,
          logSkippedDraft: input.logSkippedDraft,
        });
        if (created > 0) {
          await input.sandbox.execute(`rm -f "${filePath}"`);
        }
      } catch (error) {
        input.logDraftError?.(filePath, error);
      }
    }),
  );
}

export async function importIntegrationSkillDraftContent(input: {
  userId: string;
  rawContent: string;
  logSkippedDraft?: (slug: string, error: unknown) => void;
}): Promise<number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawContent);
  } catch {
    return 0;
  }

  const drafts = Array.isArray(parsed) ? parsed : [parsed];
  const creationResults = await Promise.all(
    drafts.map(async (draft) => {
      if (!draft || typeof draft !== "object") {
        return 0;
      }
      const rec = draft as Record<string, unknown>;
      const slug = typeof rec.slug === "string" ? rec.slug : "";
      const title = typeof rec.title === "string" ? rec.title : "";
      const description = typeof rec.description === "string" ? rec.description : "";
      if (!slug || !title || !description) {
        return 0;
      }

      const files = Array.isArray(rec.files)
        ? rec.files
            .map((entry) => {
              if (!entry || typeof entry !== "object") {
                return null;
              }
              const e = entry as Record<string, unknown>;
              if (typeof e.path !== "string" || typeof e.content !== "string") {
                return null;
              }
              return { path: e.path, content: e.content };
            })
            .filter((entry): entry is { path: string; content: string } => !!entry)
        : [];

      try {
        await createCommunityIntegrationSkill(input.userId, {
          slug,
          title,
          description,
          files,
          setAsPreferred: rec.setAsPreferred === true,
        });
        return 1;
      } catch (error) {
        input.logSkippedDraft?.(slug, error);
        return 0;
      }
    }),
  );

  return creationResults.reduce<number>((sum, value) => sum + value, 0);
}
