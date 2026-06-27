import { relations } from "drizzle-orm";
import {
  account,
  billingLedger,
  billingTopUp,
  cloudAccountLink,
  connectedIdentity,
  conversation,
  conversationQueuedMessage,
  conversationRuntime,
  conversationSessionSnapshot,
  coworker,
  coworkerDocument,
  coworkerEmailAlias,
  coworkerFolder,
  coworkerRun,
  coworkerRunEvent,
  customIntegration,
  customIntegrationCredential,
  device,
  fileAsset,
  fileAssetReference,
  generation,
  generationInterrupt,
  integration,
  integrationSkill,
  integrationSkillFile,
  integrationSkillPreference,
  integrationToken,
  memoryChunk,
  memoryEntry,
  memoryFile,
  memorySettings,
  message,
  messageAttachment,
  providerAuth,
  runtimeVolume,
  sandboxFile,
  session,
  sessionTranscript,
  sessionTranscriptChunk,
  sharedProviderAuth,
  skill,
  skillDocument,
  skillFile,
  slackConversation,
  slackUserLink,
  uploadSession,
  user,
  userDailyActivity,
  webPushSubscription,
  workspace,
  workspaceMcpAuthorization,
  workspaceMcpServer,
  workspaceMember,
  invitation,
} from "./tables";

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  dailyActivities: many(userDailyActivity),
  webPushSubscriptions: many(webPushSubscription),
  workspaceMemberships: many(workspaceMember),
  workspaceInvitations: many(invitation),
  conversations: many(conversation),
  fileAssetsCreated: many(fileAsset),
  uploadSessions: many(uploadSession),
  billingLedgers: many(billingLedger),
  integrations: many(integration),
  skills: many(skill),
  memoryFiles: many(memoryFile),
  memoryEntries: many(memoryEntry),
  memoryChunks: many(memoryChunk),
  memorySettings: many(memorySettings),
  coworkers: many(coworker),
  providerAuths: many(providerAuth),
  sharedProviderAuthsManaged: many(sharedProviderAuth),
  cloudAccountLinks: many(cloudAccountLink),
  devices: many(device),
  customIntegrations: many(customIntegration),
  customIntegrationCredentials: many(customIntegrationCredential),
  workspaceMcpServersCreated: many(workspaceMcpServer, {
    relationName: "workspaceMcpServerCreatedByUser",
  }),
  workspaceMcpServersUpdated: many(workspaceMcpServer, {
    relationName: "workspaceMcpServerUpdatedByUser",
  }),
  workspaceMcpAuthorizations: many(workspaceMcpAuthorization),
  integrationSkillsCreated: many(integrationSkill),
  integrationSkillPreferences: many(integrationSkillPreference),
  runtimeVolumes: many(runtimeVolume),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const workspaceRelations = relations(workspace, ({ many }) => ({
  members: many(workspaceMember),
  invitations: many(invitation),
  conversations: many(conversation),
  fileAssets: many(fileAsset),
  uploadSessions: many(uploadSession),
  billingLedgers: many(billingLedger),
  billingTopUps: many(billingTopUp),
  skills: many(skill),
  workspaceMcpServers: many(workspaceMcpServer),
  runtimeVolumes: many(runtimeVolume),
}));

export const workspaceMemberRelations = relations(workspaceMember, ({ one }) => ({
  workspace: one(workspace, {
    fields: [workspaceMember.organizationId],
    references: [workspace.id],
  }),
  user: one(user, {
    fields: [workspaceMember.userId],
    references: [user.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  workspace: one(workspace, {
    fields: [invitation.organizationId],
    references: [workspace.id],
  }),
  user: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));

export const fileAssetRelations = relations(fileAsset, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [fileAsset.workspaceId],
    references: [workspace.id],
  }),
  createdByUser: one(user, {
    fields: [fileAsset.createdByUserId],
    references: [user.id],
  }),
  uploadSessions: many(uploadSession),
  references: many(fileAssetReference),
  messageAttachments: many(messageAttachment),
  coworkerDocuments: many(coworkerDocument),
  skillDocuments: many(skillDocument),
  sandboxFiles: many(sandboxFile),
}));

export const uploadSessionRelations = relations(uploadSession, ({ one }) => ({
  workspace: one(workspace, {
    fields: [uploadSession.workspaceId],
    references: [workspace.id],
  }),
  user: one(user, {
    fields: [uploadSession.userId],
    references: [user.id],
  }),
  fileAsset: one(fileAsset, {
    fields: [uploadSession.fileAssetId],
    references: [fileAsset.id],
  }),
}));

export const fileAssetReferenceRelations = relations(fileAssetReference, ({ one }) => ({
  fileAsset: one(fileAsset, {
    fields: [fileAssetReference.fileAssetId],
    references: [fileAsset.id],
  }),
}));

export const userDailyActivityRelations = relations(userDailyActivity, ({ one }) => ({
  user: one(user, {
    fields: [userDailyActivity.userId],
    references: [user.id],
  }),
}));

export const webPushSubscriptionRelations = relations(webPushSubscription, ({ one }) => ({
  user: one(user, {
    fields: [webPushSubscription.userId],
    references: [user.id],
  }),
}));

export const conversationRelations = relations(conversation, ({ one, many }) => ({
  user: one(user, { fields: [conversation.userId], references: [user.id] }),
  workspace: one(workspace, {
    fields: [conversation.workspaceId],
    references: [workspace.id],
  }),
  messages: many(message),
  generations: many(generation),
  runtime: one(conversationRuntime, {
    fields: [conversation.id],
    references: [conversationRuntime.conversationId],
  }),
  sessionSnapshot: one(conversationSessionSnapshot, {
    fields: [conversation.id],
    references: [conversationSessionSnapshot.conversationId],
  }),
  billingLedgers: many(billingLedger),
  queuedMessages: many(conversationQueuedMessage),
  coworkerRuns: many(coworkerRun),
}));

export const conversationRuntimeRelations = relations(conversationRuntime, ({ one, many }) => ({
  conversation: one(conversation, {
    fields: [conversationRuntime.conversationId],
    references: [conversation.id],
  }),
  activeGeneration: one(generation, {
    fields: [conversationRuntime.activeGenerationId],
    references: [generation.id],
  }),
  generations: many(generation),
  interrupts: many(generationInterrupt),
}));

export const conversationSessionSnapshotRelations = relations(
  conversationSessionSnapshot,
  ({ one }) => ({
    conversation: one(conversation, {
      fields: [conversationSessionSnapshot.conversationId],
      references: [conversation.id],
    }),
  }),
);

export const messageRelations = relations(message, ({ one, many }) => ({
  conversation: one(conversation, {
    fields: [message.conversationId],
    references: [conversation.id],
  }),
  parentMessage: one(message, {
    fields: [message.parentMessageId],
    references: [message.id],
    relationName: "parentMessage",
  }),
  attachments: many(messageAttachment),
  sandboxFiles: many(sandboxFile),
}));

export const messageAttachmentRelations = relations(messageAttachment, ({ one }) => ({
  message: one(message, {
    fields: [messageAttachment.messageId],
    references: [message.id],
  }),
  fileAsset: one(fileAsset, {
    fields: [messageAttachment.fileAssetId],
    references: [fileAsset.id],
  }),
}));

export const sandboxFileRelations = relations(sandboxFile, ({ one }) => ({
  message: one(message, {
    fields: [sandboxFile.messageId],
    references: [message.id],
  }),
  conversation: one(conversation, {
    fields: [sandboxFile.conversationId],
    references: [conversation.id],
  }),
  fileAsset: one(fileAsset, {
    fields: [sandboxFile.fileAssetId],
    references: [fileAsset.id],
  }),
}));

export const generationRelations = relations(generation, ({ one, many }) => ({
  conversation: one(conversation, {
    fields: [generation.conversationId],
    references: [conversation.id],
  }),
  runtime: one(conversationRuntime, {
    fields: [generation.runtimeId],
    references: [conversationRuntime.id],
  }),
  message: one(message, {
    fields: [generation.messageId],
    references: [message.id],
  }),
  reconciledRuntimeVolumes: many(runtimeVolume),
}));

export const billingLedgerRelations = relations(billingLedger, ({ one }) => ({
  generation: one(generation, {
    fields: [billingLedger.generationId],
    references: [generation.id],
  }),
  conversation: one(conversation, {
    fields: [billingLedger.conversationId],
    references: [conversation.id],
  }),
  user: one(user, {
    fields: [billingLedger.userId],
    references: [user.id],
  }),
  workspace: one(workspace, {
    fields: [billingLedger.workspaceId],
    references: [workspace.id],
  }),
}));

export const billingTopUpRelations = relations(billingTopUp, ({ one }) => ({
  user: one(user, {
    fields: [billingTopUp.userId],
    references: [user.id],
  }),
  workspace: one(workspace, {
    fields: [billingTopUp.workspaceId],
    references: [workspace.id],
  }),
  grantedByUser: one(user, {
    fields: [billingTopUp.grantedByUserId],
    references: [user.id],
    relationName: "billingTopUpGrantedByUser",
  }),
}));

export const conversationQueuedMessageRelations = relations(
  conversationQueuedMessage,
  ({ one }) => ({
    conversation: one(conversation, {
      fields: [conversationQueuedMessage.conversationId],
      references: [conversation.id],
    }),
    generation: one(generation, {
      fields: [conversationQueuedMessage.generationId],
      references: [generation.id],
    }),
    user: one(user, {
      fields: [conversationQueuedMessage.userId],
      references: [user.id],
    }),
  }),
);

export const coworkerRelations = relations(coworker, ({ one, many }) => ({
  owner: one(user, { fields: [coworker.ownerId], references: [user.id] }),
  workspace: one(workspace, {
    fields: [coworker.workspaceId],
    references: [workspace.id],
  }),
  folder: one(coworkerFolder, {
    fields: [coworker.folderId],
    references: [coworkerFolder.id],
  }),
  runs: many(coworkerRun),
  documents: many(coworkerDocument),
  emailAliases: many(coworkerEmailAlias),
  runtimeVolumes: many(runtimeVolume),
}));

export const coworkerFolderRelations = relations(coworkerFolder, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [coworkerFolder.workspaceId],
    references: [workspace.id],
  }),
  owner: one(user, {
    fields: [coworkerFolder.ownerId],
    references: [user.id],
  }),
  parent: one(coworkerFolder, {
    fields: [coworkerFolder.parentId],
    references: [coworkerFolder.id],
    relationName: "coworkerFolderChildren",
  }),
  children: many(coworkerFolder, { relationName: "coworkerFolderChildren" }),
  coworkers: many(coworker),
}));

export const coworkerRunRelations = relations(coworkerRun, ({ one, many }) => ({
  coworker: one(coworker, {
    fields: [coworkerRun.coworkerId],
    references: [coworker.id],
  }),
  owner: one(user, {
    fields: [coworkerRun.ownerId],
    references: [user.id],
  }),
  workspace: one(workspace, {
    fields: [coworkerRun.workspaceId],
    references: [workspace.id],
  }),
  generation: one(generation, {
    fields: [coworkerRun.generationId],
    references: [generation.id],
  }),
  conversation: one(conversation, {
    fields: [coworkerRun.conversationId],
    references: [conversation.id],
  }),
  events: many(coworkerRunEvent),
}));

export const coworkerDocumentRelations = relations(coworkerDocument, ({ one }) => ({
  coworker: one(coworker, {
    fields: [coworkerDocument.coworkerId],
    references: [coworker.id],
  }),
  fileAsset: one(fileAsset, {
    fields: [coworkerDocument.fileAssetId],
    references: [fileAsset.id],
  }),
}));

export const coworkerRunEventRelations = relations(coworkerRunEvent, ({ one }) => ({
  run: one(coworkerRun, {
    fields: [coworkerRunEvent.coworkerRunId],
    references: [coworkerRun.id],
  }),
}));

export const coworkerEmailAliasRelations = relations(coworkerEmailAlias, ({ one }) => ({
  coworker: one(coworker, {
    fields: [coworkerEmailAlias.coworkerId],
    references: [coworker.id],
  }),
  replacedByAlias: one(coworkerEmailAlias, {
    fields: [coworkerEmailAlias.replacedByAliasId],
    references: [coworkerEmailAlias.id],
    relationName: "replacedByAlias",
  }),
}));

export const runtimeVolumeRelations = relations(runtimeVolume, ({ one }) => ({
  workspace: one(workspace, {
    fields: [runtimeVolume.workspaceId],
    references: [workspace.id],
  }),
  ownerUser: one(user, {
    fields: [runtimeVolume.ownerUserId],
    references: [user.id],
  }),
  coworker: one(coworker, {
    fields: [runtimeVolume.coworkerId],
    references: [coworker.id],
  }),
  lastReconciledGeneration: one(generation, {
    fields: [runtimeVolume.lastReconciledGenerationId],
    references: [generation.id],
  }),
}));

export const integrationRelations = relations(integration, ({ one, many }) => ({
  user: one(user, { fields: [integration.userId], references: [user.id] }),
  connectedIdentity: one(connectedIdentity, {
    fields: [integration.connectedIdentityId],
    references: [connectedIdentity.id],
  }),
  tokens: many(integrationToken),
}));

export const connectedIdentityRelations = relations(connectedIdentity, ({ one, many }) => ({
  user: one(user, { fields: [connectedIdentity.userId], references: [user.id] }),
  integrations: many(integration),
}));

export const integrationTokenRelations = relations(integrationToken, ({ one }) => ({
  integration: one(integration, {
    fields: [integrationToken.integrationId],
    references: [integration.id],
  }),
}));

// ========== SKILL SCHEMA ==========

export const skillRelations = relations(skill, ({ one, many }) => ({
  user: one(user, { fields: [skill.userId], references: [user.id] }),
  workspace: one(workspace, { fields: [skill.workspaceId], references: [workspace.id] }),
  files: many(skillFile),
  documents: many(skillDocument),
}));

export const skillFileRelations = relations(skillFile, ({ one }) => ({
  skill: one(skill, {
    fields: [skillFile.skillId],
    references: [skill.id],
  }),
}));

export const skillDocumentRelations = relations(skillDocument, ({ one }) => ({
  skill: one(skill, {
    fields: [skillDocument.skillId],
    references: [skill.id],
  }),
  fileAsset: one(fileAsset, {
    fields: [skillDocument.fileAssetId],
    references: [fileAsset.id],
  }),
}));

export const memoryFileRelations = relations(memoryFile, ({ one, many }) => ({
  user: one(user, { fields: [memoryFile.userId], references: [user.id] }),
  entries: many(memoryEntry),
  chunks: many(memoryChunk),
}));

export const memoryEntryRelations = relations(memoryEntry, ({ one, many }) => ({
  user: one(user, { fields: [memoryEntry.userId], references: [user.id] }),
  file: one(memoryFile, {
    fields: [memoryEntry.fileId],
    references: [memoryFile.id],
  }),
  chunks: many(memoryChunk),
}));

export const memoryChunkRelations = relations(memoryChunk, ({ one }) => ({
  user: one(user, { fields: [memoryChunk.userId], references: [user.id] }),
  file: one(memoryFile, {
    fields: [memoryChunk.fileId],
    references: [memoryFile.id],
  }),
  entry: one(memoryEntry, {
    fields: [memoryChunk.entryId],
    references: [memoryEntry.id],
  }),
}));

export const memorySettingsRelations = relations(memorySettings, ({ one }) => ({
  user: one(user, { fields: [memorySettings.userId], references: [user.id] }),
}));

// ========== SESSION TRANSCRIPTS ==========

export const sessionTranscriptRelations = relations(sessionTranscript, ({ one, many }) => ({
  user: one(user, {
    fields: [sessionTranscript.userId],
    references: [user.id],
  }),
  conversation: one(conversation, {
    fields: [sessionTranscript.conversationId],
    references: [conversation.id],
  }),
  chunks: many(sessionTranscriptChunk),
}));

export const sessionTranscriptChunkRelations = relations(sessionTranscriptChunk, ({ one }) => ({
  user: one(user, {
    fields: [sessionTranscriptChunk.userId],
    references: [user.id],
  }),
  transcript: one(sessionTranscript, {
    fields: [sessionTranscriptChunk.transcriptId],
    references: [sessionTranscript.id],
  }),
}));

// ========== PROVIDER AUTH SCHEMA ==========
// Stores encrypted provider credentials for subscription providers (ChatGPT, Gemini, Kimi)

export const providerAuthRelations = relations(providerAuth, ({ one }) => ({
  user: one(user, {
    fields: [providerAuth.userId],
    references: [user.id],
  }),
}));

export const sharedProviderAuthRelations = relations(sharedProviderAuth, ({ one }) => ({
  managedByUser: one(user, {
    fields: [sharedProviderAuth.managedByUserId],
    references: [user.id],
  }),
}));

export const cloudAccountLinkRelations = relations(cloudAccountLink, ({ one }) => ({
  user: one(user, {
    fields: [cloudAccountLink.userId],
    references: [user.id],
  }),
}));

// ========== DEVICE CODE (Better Auth plugin) ==========

export const deviceRelations = relations(device, ({ one }) => ({
  user: one(user, { fields: [device.userId], references: [user.id] }),
}));

// ─── Custom Integrations ─────────────────────────────────────

export const customIntegrationRelations = relations(customIntegration, ({ one, many }) => ({
  createdBy: one(user, {
    fields: [customIntegration.createdByUserId],
    references: [user.id],
  }),
  credentials: many(customIntegrationCredential),
}));

export const customIntegrationCredentialRelations = relations(
  customIntegrationCredential,
  ({ one }) => ({
    user: one(user, {
      fields: [customIntegrationCredential.userId],
      references: [user.id],
    }),
    customIntegration: one(customIntegration, {
      fields: [customIntegrationCredential.customIntegrationId],
      references: [customIntegration.id],
    }),
  }),
);

export const workspaceMcpServerRelations = relations(
  workspaceMcpServer,
  ({ one, many }) => ({
    workspace: one(workspace, {
      fields: [workspaceMcpServer.workspaceId],
      references: [workspace.id],
    }),
    createdByUser: one(user, {
      relationName: "workspaceMcpServerCreatedByUser",
      fields: [workspaceMcpServer.createdByUserId],
      references: [user.id],
    }),
    updatedByUser: one(user, {
      relationName: "workspaceMcpServerUpdatedByUser",
      fields: [workspaceMcpServer.updatedByUserId],
      references: [user.id],
    }),
    credentials: many(workspaceMcpAuthorization),
  }),
);

export const workspaceMcpAuthorizationRelations = relations(
  workspaceMcpAuthorization,
  ({ one }) => ({
    user: one(user, {
      fields: [workspaceMcpAuthorization.userId],
      references: [user.id],
    }),
    workspaceMcpServer: one(workspaceMcpServer, {
      fields: [workspaceMcpAuthorization.workspaceMcpServerId],
      references: [workspaceMcpServer.id],
    }),
  }),
);

export const integrationSkillRelations = relations(integrationSkill, ({ one, many }) => ({
  createdBy: one(user, {
    fields: [integrationSkill.createdByUserId],
    references: [user.id],
  }),
  files: many(integrationSkillFile),
}));

export const integrationSkillFileRelations = relations(integrationSkillFile, ({ one }) => ({
  integrationSkill: one(integrationSkill, {
    fields: [integrationSkillFile.integrationSkillId],
    references: [integrationSkill.id],
  }),
}));

export const integrationSkillPreferenceRelations = relations(
  integrationSkillPreference,
  ({ one }) => ({
    user: one(user, {
      fields: [integrationSkillPreference.userId],
      references: [user.id],
    }),
    preferredSkill: one(integrationSkill, {
      fields: [integrationSkillPreference.preferredSkillId],
      references: [integrationSkill.id],
    }),
  }),
);

// ─── Slack Bot ───────────────────────────────────────────────

export const slackUserLinkRelations = relations(slackUserLink, ({ one }) => ({
  user: one(user, {
    fields: [slackUserLink.userId],
    references: [user.id],
  }),
}));

export const slackConversationRelations = relations(slackConversation, ({ one }) => ({
  conversation: one(conversation, {
    fields: [slackConversation.conversationId],
    references: [conversation.id],
  }),
  user: one(user, {
    fields: [slackConversation.userId],
    references: [user.id],
  }),
}));
