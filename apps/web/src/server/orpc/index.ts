import { baseProcedure } from "./middleware";
import { adminRouter } from "./routers/admin";
import { adminSharedProviderAuthRouter } from "./routers/admin-shared-provider-auth";
import { agenticAuditRouter } from "./routers/agentic-audit";
import { billingRouter } from "./routers/billing";
import { conversationRouter } from "./routers/conversation";
import { coworkerFolderRouter } from "./routers/coworker-folder";
import { coworkerRouter } from "./routers/coworker";
import { workspaceMcpServerRouter } from "./routers/executor-source";
import { fileAssetRouter } from "./routers/file-asset";
import { galienRouter } from "./routers/galien";
import { generationRouter } from "./routers/generation";
import { inboxRouter } from "./routers/inbox";
import { integrationRouter } from "./routers/integration";
import { integrationSkillRouter } from "./routers/integration-skill";
import { modulrRouter } from "./routers/modulr";
import { providerAuthRouter } from "./routers/provider-auth";
import { skillRouter } from "./routers/skill";
import { templateRouter } from "./routers/template";
import { userRouter } from "./routers/user";
import { voiceRouter } from "./routers/voice";

const ping = baseProcedure.handler(async () => ({
  status: "ok" as const,
  timestamp: new Date().toISOString(),
}));

export const appRouter = {
  admin: adminRouter,
  adminSharedProviderAuth: adminSharedProviderAuthRouter,
  agenticAudit: agenticAuditRouter,
  billing: billingRouter,
  conversation: conversationRouter,
  fileAsset: fileAssetRouter,
  generation: generationRouter,
  galien: galienRouter,
  inbox: inboxRouter,
  integration: integrationRouter,
  integrationSkill: integrationSkillRouter,
  modulr: modulrRouter,
  providerAuth: providerAuthRouter,
  workspaceMcpServer: workspaceMcpServerRouter,
  skill: skillRouter,
  template: templateRouter,
  user: userRouter,
  voice: voiceRouter,
  coworker: coworkerRouter,
  coworkerFolder: coworkerFolderRouter,
  health: { ping },
};

export type AppRouter = typeof appRouter;
