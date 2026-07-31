import { coworkerAdminProcedures } from "./coworker/admin.router";
import { coworkerAutomationOwnerProcedures } from "./coworker/automation-owner.router";
import { coworkerBuilderProcedures } from "./coworker/builder.router";
import { coworkerCatalogProcedures } from "./coworker/catalog.router";
import { coworkerDashboardProcedures } from "./coworker/dashboard.router";
import { coworkerDefinitionProcedures } from "./coworker/definition.router";
import { coworkerDocumentProcedures } from "./coworker/documents.router";
import { coworkerForwardingAliasProcedures } from "./coworker/forwarding-alias.router";
import { coworkerHistoryProcedures } from "./coworker/history.router";
import { coworkerImpersonationProcedures } from "./coworker/impersonation.router";
import { coworkerProfileProcedures } from "./coworker/profile.router";
import { coworkerRemoteIntegrationProcedures } from "./coworker/remote-integrations.router";
import { coworkerRunProcedures } from "./coworker/runs.router";
import { coworkerRevisionProcedures } from "./coworker/revisions.router";
import { coworkerSharingProcedures } from "./coworker/sharing.router";
import { coworkerTriggerProcedures } from "./coworker/trigger.router";
import { coworkerWorkspaceMoveProcedures } from "./coworker/workspace-move.router";

export const coworkerRouter = {
  list: coworkerCatalogProcedures.list,
  get: coworkerCatalogProcedures.get,
  listUsers: coworkerCatalogProcedures.listUsers,
  getHistory: coworkerHistoryProcedures.getHistory,
  getOverview: coworkerDashboardProcedures.getOverview,
  getUsageDashboard: coworkerDashboardProcedures.getUsageDashboard,
  getImpersonationTarget: coworkerImpersonationProcedures.getImpersonationTarget,
  create: coworkerProfileProcedures.create,
  update: coworkerProfileProcedures.update,
  setStatus: coworkerProfileProcedures.setStatus,
  edit: coworkerBuilderProcedures.edit,
  uploadDocument: coworkerDocumentProcedures.uploadDocument,
  updateDocument: coworkerDocumentProcedures.updateDocument,
  getDocumentUrl: coworkerDocumentProcedures.getDocumentUrl,
  deleteDocument: coworkerDocumentProcedures.deleteDocument,
  delete: coworkerProfileProcedures.delete,
  moveWorkspace: coworkerWorkspaceMoveProcedures.moveWorkspace,
  trigger: coworkerTriggerProcedures.trigger,
  listRemoteIntegrationTargets: coworkerRemoteIntegrationProcedures.listRemoteIntegrationTargets,
  searchRemoteIntegrationUsers: coworkerRemoteIntegrationProcedures.searchRemoteIntegrationUsers,
  getRun: coworkerRunProcedures.getRun,
  getRunImpersonationTarget: coworkerRunProcedures.getRunImpersonationTarget,
  listRuns: coworkerRunProcedures.listRuns,
  listWorkspaceRuns: coworkerRunProcedures.listWorkspaceRuns,
  resetRunsAndEnable: coworkerRunProcedures.resetRunsAndEnable,
  listRevisions: coworkerRevisionProcedures.listRevisions,
  getRevision: coworkerRevisionProcedures.getRevision,
  restoreRevision: coworkerRevisionProcedures.restoreRevision,
  getAutomationOwner: coworkerAutomationOwnerProcedures.getAutomationOwner,
  proposeAutomationOwner: coworkerAutomationOwnerProcedures.proposeAutomationOwner,
  respondToAutomationOwnerProposal:
    coworkerAutomationOwnerProcedures.respondToAutomationOwnerProposal,
  getAutomationRegistrations: coworkerAutomationOwnerProcedures.getAutomationRegistrations,
  registerForAutomation: coworkerAutomationOwnerProcedures.registerForAutomation,
  changeAutomationRegistration: coworkerAutomationOwnerProcedures.changeAutomationRegistration,
  getMyAutomationAccountPreferences:
    coworkerAutomationOwnerProcedures.getMyAutomationAccountPreferences,
  setMyAutomationAccountPreference:
    coworkerAutomationOwnerProcedures.setMyAutomationAccountPreference,
  getForwardingAlias: coworkerForwardingAliasProcedures.getForwardingAlias,
  createForwardingAlias: coworkerForwardingAliasProcedures.createForwardingAlias,
  disableForwardingAlias: coworkerForwardingAliasProcedures.disableForwardingAlias,
  rotateForwardingAlias: coworkerForwardingAliasProcedures.rotateForwardingAlias,
  share: coworkerSharingProcedures.share,
  unshare: coworkerSharingProcedures.unshare,
  listShared: coworkerSharingProcedures.listShared,
  exportDefinition: coworkerDefinitionProcedures.exportDefinition,
  importDefinition: coworkerDefinitionProcedures.importDefinition,
  adminListWorkspaceCoworkers: coworkerAdminProcedures.adminListWorkspaceCoworkers,
  adminGetWorkspaceRun: coworkerAdminProcedures.adminGetWorkspaceRun,
  getOrCreateBuilderConversation: coworkerBuilderProcedures.getOrCreateBuilderConversation,
  getInstructionDocumentChanges: coworkerBuilderProcedures.getInstructionDocumentChanges,
};
