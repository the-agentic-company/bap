// Barrel for the OpenCode runtime driver toolbox.
//
// This path is the stable seam every caller imports from. The behaviour now
// lives in three concern-focused modules — runtime events, the approval
// protocol, and prompt-completion/transcript resolution — plus a shared
// error-format module. Each behind-the-barrel module is internally deep; this
// file only re-exports the same public names the callers already use.

export {
  type OpenCodeTrackedEvent,
  type OpenCodeActionableEvent,
  type OpenCodeRuntimeToolRef,
  type OpenCodeTerminalEventOutcome,
  type OpenCodeRuntimeEventInspection,
  type OpenCodeRuntimeStreamStats,
  type OpenCodeRuntimeEventProcessResult,
  type OpenCodeTrackedEventProcessor,
  type OpenCodeRuntimeEventLoopCallbacks,
  type OpenCodeRuntimeEventLoopSnapshot,
  isOpenCodeTrackedEvent,
  isOpenCodeActionableEvent,
  inspectOpenCodeRuntimeEvent,
  processOpenCodeRuntimeEvent,
  OpenCodeRuntimeEventLoop,
  extractOpenCodeMessageErrorFromSessionMessages,
  updateOpenCodeToolPart,
} from "./opencode-runtime-events";

export {
  type OpenCodeApprovalCapableClient,
  type OpenCodeApprovalRuntimeRequest,
  type OpenCodeActionableHandlingResult,
  shouldAutoApproveOpenCodePermission,
  replyOpenCodePermissionRequest,
  replyOpenCodeQuestionRequest,
  rejectOpenCodeQuestionRequest,
  sendOpenCodeApprovalRuntimeDecision,
  handleOpenCodeActionableEvent,
} from "./opencode-runtime-approvals";

export {
  type OpenCodeTerminalReconciliationOutcome,
  type OpenCodeEmptyCompletionDiagnostics,
  type OpenCodePromptResultEnvelope,
  type OpenCodePromptCompletionResolution,
  describeSessionMessagesPayload,
  describePromptResultData,
  isOpaqueDiagnosticMessage,
  extractAssistantTextFromSessionMessagesPayload,
  extractAssistantTextFromPromptResultData,
  getRuntimeStatusTypeForSession,
  collectOpenCodeEmptyCompletionDiagnostics,
  resolveOpenCodePromptCompletion,
  waitForOpenCodeTerminalStateAfterEarlyStreamEnd,
  captureOpenCodeUsageFromSession,
} from "./opencode-prompt-completion";

export { summarizeUnknownValue } from "./opencode-runtime-error-format";
