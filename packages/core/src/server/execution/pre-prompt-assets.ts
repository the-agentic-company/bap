import path from "path";
import { db } from "@bap/db/client";
import { customIntegrationCredential } from "@bap/db/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "../utils/observability";
import type { SandboxHandle } from "../sandbox/core/types";
import {
  writeSandboxCommonLibToSandbox,
  writeSkillsAgentsIndexToSandbox,
  writeResolvedIntegrationSkillsToSandbox,
  writeSkillsToSandbox,
} from "../sandbox/prep/skills-prep";
import {
  buildRuntimeVolumeMountPlan,
  prepareRuntimeVolumesForSandbox,
  type RuntimeVolumeMountPlan,
  type RuntimeVolumeSkillScope,
} from "../sandbox/prep/runtime-volume-prep";
import { listAccessibleEnabledSkillMetadataForUser } from "../services/workspace-skill-service";

const PRE_PROMPT_CACHE_PATH = "/app/.opencode/pre-prompt-cache.json";

type PrePromptCacheRecord = {
  version: 1;
  cacheKey: string;
  writtenSkills: string[];
  writtenIntegrationSkills: string[];
  updatedAt: string;
};

type PrePromptAssetStep = <T>(
  stepName: string,
  metricName: string,
  fn: () => Promise<T>,
) => Promise<T>;

export type PrePromptAssetsLogContext = {
  source: string;
  traceId: string;
  generationId: string;
  conversationId: string;
  userId: string;
  sandboxId?: string;
  sessionId?: string;
};

export type StagePrePromptAssetsResult = {
  enabledSkillRows: SkillMetadataRow[];
  writtenSkills: string[];
  writtenIntegrationSkills: string[];
  prePromptCacheHit: boolean;
  startPostPromptCacheWrite: (() => Promise<void>) | null;
  runtimeVolumeMountPlan: RuntimeVolumeMountPlan | null;
};

type SkillMetadataRow = {
  name: string;
  displayName?: string | null;
  description?: string | null;
  visibility: "private" | "public";
  userId: string;
  updatedAt: Date;
};

export async function stagePrePromptAssets(input: {
  runtimeSandbox: SandboxHandle;
  userId: string;
  workspaceId?: string | null;
  generationId: string;
  allowedIntegrations: Iterable<string>;
  allowedCustomIntegrations?: readonly string[] | null;
  allowedSkillSlugs?: readonly string[] | null;
  selectedPlatformSkillSlugs?: readonly string[] | null;
  customSkillNames?: readonly string[];
  runtimeVolumeSkillScope?: RuntimeVolumeSkillScope;
  coworkerDocumentsCoworkerId?: string | null;
  agentSandboxMode?: string | null;
  runStep: PrePromptAssetStep;
  markPhase: (phase: string) => void;
  recordMetric: (metricName: string, durationMs: number) => void;
  logContext: () => PrePromptAssetsLogContext;
}): Promise<StagePrePromptAssetsResult> {
  let enabledSkillRows: SkillMetadataRow[] = [];
  let writtenSkills: string[] = [];
  let writtenIntegrationSkills: string[] = [];
  let prePromptCacheHit = false;
  let startPostPromptCacheWrite: (() => Promise<void>) | null = null;
  let runtimeVolumeMountPlan: RuntimeVolumeMountPlan | null = null;

  const [loadedSkillRows, customCreds] = await input.runStep(
    "skills_and_creds_load",
    "loadSkillsAndCredsMs",
    async () =>
      await Promise.all([
        listAccessibleEnabledSkillMetadataForUser(input.userId),
        db.query.customIntegrationCredential.findMany({
          where: and(
            eq(customIntegrationCredential.userId, input.userId),
            eq(customIntegrationCredential.enabled, true),
          ),
          with: { customIntegration: true },
        }),
      ]),
  );
  enabledSkillRows = loadedSkillRows;

  const eligibleCustomCreds = customCreds.filter((cred) => {
    if (!input.allowedCustomIntegrations) {
      return true;
    }
    return input.allowedCustomIntegrations.includes(cred.customIntegration.slug);
  });

  const prePromptCacheKey = await input.runStep(
    "cache_key_build",
    "buildPrePromptCacheKeyMs",
    async () =>
      JSON.stringify({
        userId: input.userId,
        allowedIntegrations: [...input.allowedIntegrations].toSorted(),
        allowedCustomIntegrations: [...(input.allowedCustomIntegrations ?? [])].toSorted(),
        allowedSkillSlugs: [...(input.allowedSkillSlugs ?? [])].toSorted(),
        selectedPlatformSkillSlugs: [...(input.selectedPlatformSkillSlugs ?? [])].toSorted(),
        skills: enabledSkillRows
          .map((entry) => `${entry.name}:${entry.updatedAt.toISOString()}`)
          .toSorted(),
        customIntegrations: eligibleCustomCreds
          .map(
            (cred) =>
              `${cred.customIntegration.slug}:${cred.updatedAt.toISOString()}:${cred.customIntegration.updatedAt.toISOString()}`,
          )
          .toSorted(),
      }),
  );

  await input.runStep(
    "sandbox_common_lib_write",
    "writeSandboxCommonLibMs",
    async () => await writeSandboxCommonLibToSandbox(input.runtimeSandbox),
  );

  const runtimeVolumesEnabled = input.runtimeSandbox.provider === "daytona";
  if (runtimeVolumesEnabled) {
    if (!input.workspaceId) {
      throw new Error("runtime_volume_workspace_required: workspaceId is required");
    }
    const requestedSkillScope = input.runtimeVolumeSkillScope ?? { type: "authoring" };
    const visibleSkillRows =
      requestedSkillScope.type === "selected"
        ? enabledSkillRows.filter((row) => requestedSkillScope.skillSlugs.includes(row.name))
        : enabledSkillRows;
    const visibleSkillNames = visibleSkillRows.map((row) => row.name);
    const resolvedSkillScope: RuntimeVolumeSkillScope =
      requestedSkillScope.type === "selected"
        ? {
            type: "selected",
            skillSlugs: visibleSkillNames,
            ownedSkillSlugs: visibleSkillRows
              .filter((row) => row.userId === input.userId)
              .map((row) => row.name),
            sharedSkillSlugs: visibleSkillRows
              .filter((row) => row.userId !== input.userId && row.visibility === "public")
              .map((row) => row.name),
          }
        : requestedSkillScope;

    runtimeVolumeMountPlan = buildRuntimeVolumeMountPlan({
      workspaceId: input.workspaceId,
      userId: input.userId,
      generationId: input.generationId,
      skillScope: resolvedSkillScope,
      visibleSkillNames,
      coworkerDocumentsCoworkerId: input.coworkerDocumentsCoworkerId,
    });
    await input.runStep("runtime_volume_mount", "mountRuntimeVolumesMs", async () => {
      await prepareRuntimeVolumesForSandbox({
        sandbox: input.runtimeSandbox,
        plan: runtimeVolumeMountPlan!,
      });
    });
    await input.runStep("skills_index_write", "writeSkillsIndexMs", async () => {
      await writeSkillsAgentsIndexToSandbox(input.runtimeSandbox, visibleSkillRows);
    });
    writtenSkills = visibleSkillNames;
  }

  if (input.agentSandboxMode === "reused") {
    try {
      const parsed = await input.runStep("cache_read", "readPrePromptCacheMs", async () => {
        const rawCache = await input.runtimeSandbox.readFile(PRE_PROMPT_CACHE_PATH);
        return JSON.parse(String(rawCache)) as Partial<PrePromptCacheRecord>;
      });
      if (parsed.cacheKey === prePromptCacheKey) {
        prePromptCacheHit = true;
        if (Array.isArray(parsed.writtenSkills)) {
          writtenSkills = parsed.writtenSkills.filter(
            (value): value is string => typeof value === "string",
          );
        }
        if (Array.isArray(parsed.writtenIntegrationSkills)) {
          writtenIntegrationSkills = parsed.writtenIntegrationSkills.filter(
            (value): value is string => typeof value === "string",
          );
        }
        logger.info({
          event: "PRE_PROMPT_CACHE_HIT",
          ...input.logContext(),
          skillsCount: writtenSkills.length,
          integrationSkillCount: writtenIntegrationSkills.length,
        });
      }
    } catch {
      // Cache file absent or invalid; fall back to full prep.
    }
  }

  if (!prePromptCacheHit) {
    try {
      await input.runStep("skill_asset_prepare", "prepareSkillAssetsMs", async () => {
        const skillsWritePromise = runtimeVolumeMountPlan
          ? Promise.resolve(writtenSkills)
          : input.runStep(
              "skills_write",
              "writeSkillsToSandboxMs",
              async () =>
                await writeSkillsToSandbox(
                  input.runtimeSandbox,
                  input.userId,
                  input.customSkillNames && input.customSkillNames.length > 0
                    ? [...input.customSkillNames]
                    : undefined,
                ),
            );

        const customIntegrationCliWritePromise = input.runStep(
          "custom_integration_cli_write",
          "writeCustomIntegrationCliMs",
          async () => {
            await Promise.all(
              eligibleCustomCreds.map(async (cred) => {
                const integ = cred.customIntegration;
                const cliPath = `/app/cli/custom-${integ.slug}.ts`;
                await input.runtimeSandbox.writeFile(cliPath, integ.cliCode);
              }),
            );
          },
        );

        const customPerms: Record<string, { read: string[]; write: string[] }> = {};
        for (const cred of eligibleCustomCreds) {
          const integ = cred.customIntegration;
          customPerms[`custom-${integ.slug}`] = {
            read: integ.permissions.readOps,
            write: integ.permissions.writeOps,
          };
        }

        const customIntegrationPermissionsWritePromise =
          Object.keys(customPerms).length > 0
            ? input.runStep(
                "custom_integration_permissions_write",
                "writeCustomIntegrationPermissionsMs",
                async () => {
                  await input.runtimeSandbox.exec(
                    `echo 'export CUSTOM_INTEGRATION_PERMISSIONS=${JSON.stringify(JSON.stringify(customPerms)).slice(1, -1)}' >> ~/.bashrc`,
                  );
                },
              )
            : Promise.resolve();

        const allowedSkillSlugs = new Set<string>(input.allowedIntegrations);
        for (const cred of eligibleCustomCreds) {
          allowedSkillSlugs.add(cred.customIntegration.slug);
        }

        const integrationSkillsWritePromise = input.runStep(
          "integration_skills_write",
          "writeIntegrationSkillsMs",
          async () =>
            await writeResolvedIntegrationSkillsToSandbox(
              input.runtimeSandbox,
              input.userId,
              Array.from(allowedSkillSlugs),
            ),
        );

        const [
          resolvedWrittenSkills,
          _customIntegrationCliWrite,
          _customIntegrationPermissionsWrite,
          resolvedWrittenIntegrationSkills,
        ] = await Promise.all([
          skillsWritePromise,
          customIntegrationCliWritePromise,
          customIntegrationPermissionsWritePromise,
          integrationSkillsWritePromise,
        ]);

        writtenSkills = resolvedWrittenSkills;
        writtenIntegrationSkills = resolvedWrittenIntegrationSkills;
        startPostPromptCacheWrite = async () => {
          input.markPhase("post_prompt_cache_write_started");
          const startedAt = Date.now();
          try {
            await input.runtimeSandbox.ensureDir(path.dirname(PRE_PROMPT_CACHE_PATH));
            const nextCacheRecord: PrePromptCacheRecord = {
              version: 1,
              cacheKey: prePromptCacheKey,
              writtenSkills,
              writtenIntegrationSkills,
              updatedAt: new Date().toISOString(),
            };
            await input.runtimeSandbox.writeFile(
              PRE_PROMPT_CACHE_PATH,
              JSON.stringify(nextCacheRecord, null, 2),
            );
            logger.info({
              event: "POST_PROMPT_CACHE_WRITE_COMPLETED",
              ...input.logContext(),
            });
          } catch (error) {
            console.error("[GenerationManager] Failed to write pre-prompt cache:", error);
          } finally {
            input.recordMetric("writePrePromptCacheMs", Date.now() - startedAt);
            input.markPhase("post_prompt_cache_write_completed");
          }
        };
      });
    } catch (error) {
      console.error("[Generation] Failed to write custom integration CLI code:", error);
    }
  }

  return {
    enabledSkillRows,
    writtenSkills,
    writtenIntegrationSkills,
    prePromptCacheHit,
    startPostPromptCacheWrite,
    runtimeVolumeMountPlan,
  };
}
