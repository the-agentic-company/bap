import type { CoworkerToolAccessMode } from "@bap/core/lib/coworker-tool-policy";
import type { ProviderAuthSource } from "@bap/core/lib/provider-auth-source";
import type { IntegrationType } from "@/lib/integration-icons";
import type { CoworkerSchedule } from "@/orpc/hooks/coworkers";

export type CoworkerTab = "chat" | "instruction" | "runs" | "docs" | "toolbox" | "admin";

export type RemoteIntegrationTargetEnv = "staging" | "prod";

export type RemoteIntegrationUserOption = {
  id: string;
  email: string;
  name: string | null;
  enabledIntegrationTypes: IntegrationType[];
};

export type CoworkerDocumentRecord = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  description: string | null;
  createdAt: Date | string;
};

export type UploadAttachment = {
  fileAssetId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
};

export type CoworkerEditorPayload = {
  id: string;
  name: string;
  description: string;
  username: string;
  status: "on" | "off";
  triggerType: string;
  prompt: string;
  model: string;
  authSource: ProviderAuthSource | null;
  autoApprove: boolean;
  toolAccessMode: CoworkerToolAccessMode;
  allowedIntegrations: IntegrationType[];
  allowedWorkspaceMcpServerIds: string[];
  allowedSkillSlugs: string[];
  schedule: CoworkerSchedule | null;
  requiresUserInput: boolean;
  userInputPrompt: string | null;
};

export type CoworkerScheduleType = "interval" | "daily" | "weekly" | "monthly";

export type IntegrationEntry = {
  key: IntegrationType;
  name: string;
  logo: string;
};

export type AvailableSkillEntry = {
  key: string;
  title: string;
  source: "Platform" | "Custom Public" | "Custom Private" | "Shared";
};

export type WorkspaceMcpServerEntry = {
  id: string;
  title: string;
  namespace: string;
  kind: string;
  connected: boolean;
};

export type CoworkerForwardingAlias = {
  receivingDomain: string | null;
  activeAlias: unknown | null;
  forwardingAddress: string | null;
};

export type CoworkerRunListItem = {
  id: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  errorMessage: string | null;
};

export const EMPTY_COWORKER_DOCUMENTS: CoworkerDocumentRecord[] = [];
