import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { closePool, db } from "./client";
import { coworker, coworkerRun, coworkerRunEvent, user, workspace, workspaceMember } from "./schema";

const DEFAULT_EMAIL = "bap@example.com";
const FIXTURE_USERNAME = "qa-coca-cola-backlog";
const FIXTURE_NAME = "Coca-Cola Backlog QA";

type BacklogStatus = "needs_user_input" | "awaiting_approval" | "awaiting_auth" | "paused";

const BACKLOG_STATUSES: BacklogStatus[] = [
  "needs_user_input",
  "awaiting_approval",
  "awaiting_auth",
  "paused",
  "needs_user_input",
];

function readEmailArg(): string {
  const emailFlag = process.argv.find((arg) => arg.startsWith("--email="));
  return emailFlag?.slice("--email=".length).trim() || DEFAULT_EMAIL;
}

function slugifyWorkspaceName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "qa-workspace"
  );
}

async function ensureFixtureUser(email: string) {
  const now = new Date();
  const existing = await db.query.user.findFirst({
    where: eq(user.email, email),
  });

  if (existing) {
    await db
      .update(user)
      .set({
        emailVerified: true,
        onboardedAt: existing.onboardedAt ?? now,
        updatedAt: now,
      })
      .where(eq(user.id, existing.id));
    return existing;
  }

  const [created] = await db
    .insert(user)
    .values({
      id: randomUUID(),
      email,
      name: "Bap QA",
      emailVerified: true,
      onboardedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return created;
}

async function ensureFixtureWorkspace(targetUser: typeof user.$inferSelect) {
  if (targetUser.activeWorkspaceId) {
    const activeMembership = await db.query.workspaceMember.findFirst({
      where: and(
        eq(workspaceMember.userId, targetUser.id),
        eq(workspaceMember.workspaceId, targetUser.activeWorkspaceId),
      ),
      with: { workspace: true },
    });

    if (activeMembership?.workspace) {
      return activeMembership.workspace;
    }
  }

  const latestMembership = await db.query.workspaceMember.findFirst({
    where: eq(workspaceMember.userId, targetUser.id),
    with: { workspace: true },
    orderBy: [desc(workspaceMember.createdAt)],
  });

  if (latestMembership?.workspace) {
    await db
      .update(user)
      .set({ activeWorkspaceId: latestMembership.workspace.id, updatedAt: new Date() })
      .where(eq(user.id, targetUser.id));
    return latestMembership.workspace;
  }

  const workspaceName = `${targetUser.name || "Bap QA"}'s workspace`;
  const [createdWorkspace] = await db
    .insert(workspace)
    .values({
      name: workspaceName,
      slug: `${slugifyWorkspaceName(workspaceName)}-${randomUUID().slice(0, 8)}`,
      createdByUserId: targetUser.id,
      billingPlanId: "free",
      autumnCustomerId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  await db.insert(workspaceMember).values({
    workspaceId: createdWorkspace.id,
    userId: targetUser.id,
    role: "owner",
  });

  await db
    .update(user)
    .set({ activeWorkspaceId: createdWorkspace.id, updatedAt: new Date() })
    .where(eq(user.id, targetUser.id));

  return createdWorkspace;
}

async function main() {
  const email = readEmailArg();
  const targetUser = await ensureFixtureUser(email);
  const targetWorkspace = await ensureFixtureWorkspace(targetUser);

  await db.delete(coworker).where(eq(coworker.username, FIXTURE_USERNAME));

  const now = new Date();
  const [createdCoworker] = await db
    .insert(coworker)
    .values({
      name: FIXTURE_NAME,
      ownerId: targetUser.id,
      workspaceId: targetWorkspace.id,
      status: "off",
      disabledReason: "run_backlog_limit",
      disabledAt: now,
      triggerType: "manual",
      prompt:
        "QA fixture coworker for validating the five-run backlog auto-disable and reset flow.",
      model: "anthropic/claude-sonnet-4-6",
      description: "Seeded QA coworker with five backlog runs.",
      username: FIXTURE_USERNAME,
      requiresUserInput: false,
      userInputPrompt: null,
      autoApprove: true,
      toolAccessMode: "all",
      allowedIntegrations: [],
      allowedCustomIntegrations: [],
      allowedWorkspaceMcpServerIds: [],
      allowedSkillSlugs: [],
      schedule: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const insertedRuns = await db
    .insert(coworkerRun)
    .values(
      BACKLOG_STATUSES.map((status, index) => ({
        id: randomUUID(),
        coworkerId: createdCoworker.id,
        ownerId: targetUser.id,
        workspaceId: targetWorkspace.id,
        status,
        triggerPayload: {
          source: "qa_coca_cola_fixture",
          label: "Coca-Cola five-run backlog QA",
          index: index + 1,
        },
        spawnDepth: 0,
        generationId: null,
        conversationId: null,
        startedAt: new Date(now.getTime() - (BACKLOG_STATUSES.length - index) * 60_000),
        finishedAt: null,
        errorMessage: null,
        debugInfo: {
          fixture: true,
          description: "Seeded backlog run with no live generation.",
        },
      })),
    )
    .returning();

  await db.insert(coworkerRunEvent).values(
    insertedRuns.map((run, index) => ({
      coworkerRunId: run.id,
      type: "qa_fixture",
      payload: {
        message: "Seeded backlog run for QA.",
        index: index + 1,
      },
      createdAt: run.startedAt,
    })),
  );

  console.log("Seeded coworker backlog QA fixture");
  console.log(`User: ${targetUser.email} (${targetUser.id})`);
  console.log(`Workspace: ${targetWorkspace.name} (${targetWorkspace.id})`);
  console.log(`Coworker: ${createdCoworker.name} @${createdCoworker.username}`);
  console.log(`Coworker ID: ${createdCoworker.id}`);
  console.log(`Backlog runs: ${insertedRuns.length}`);
  console.log(`Open: /agents/edit/${createdCoworker.username}`);
}

main()
  .catch((err) => {
    console.error("Coworker backlog fixture seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
