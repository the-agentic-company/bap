// oxlint-disable jsx-a11y/control-has-associated-label

import { T } from "gt-react";
import { Loader2 } from "lucide-react";
import { ImpersonationRequiredPage } from "@/components/impersonation/impersonation-required-page";
import { useIsMobile } from "@/hooks/use-mobile";
import { getCoworkerInfoHref } from "@/lib/coworker-routes";
import {
  CoworkerEditorDesktopLayout,
  CoworkerEditorMobileLayout,
} from "./coworker-editor/coworker-editor-layout";
import { CoworkerChatPanelBackHrefProvider } from "./coworker-editor/coworker-chat-panel";
import { useCoworkerEditorPage } from "./coworker-editor/use-coworker-editor-page";

type CoworkerEditorPageProps = {
  coworkerIdOverride?: string;
  embedded?: boolean;
};

export default function CoworkerEditorPage({
  coworkerIdOverride,
  embedded = false,
}: CoworkerEditorPageProps = {}) {
  const isMobile = useIsMobile();
  const {
    coworker,
    isInitialLoading,
    routeRunId,
    impersonationTarget,
    currentRoutePath,
    isAdmin,
    activeTab,
    status,
    isRunDisabled,
    isRunning,
    isDeleting,
    showDeleteDialog,
    coworkerDisplayName,
    isInstructionPanelCollapsed,
    setIsInstructionPanelCollapsed,
    chatPanel,
    renderSettingsPanel,
    autoApproveDialog,
    handleTabChange,
    handleStatusChange,
    handleRunClick,
    handleOpenDeleteDialog,
    setShowDeleteDialog,
    handleDelete,
  } = useCoworkerEditorPage({ coworkerIdOverride, embedded, isMobile });

  if (isInitialLoading) {
    return (
      <div className="text-muted-foreground flex h-full min-h-0 w-full flex-1 items-center justify-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>
          <T>Loading coworker</T>
        </span>
      </div>
    );
  }

  if (!coworker) {
    if (impersonationTarget) {
      return (
        <ImpersonationRequiredPage target={impersonationTarget} redirectPath={currentRoutePath} />
      );
    }

    return (
      <div className="text-muted-foreground flex h-full min-h-0 w-full flex-1 items-center justify-center p-6 text-sm">
        {routeRunId ? "Run not found." : "Coworker not found."}
      </div>
    );
  }

  const backHref = embedded
    ? undefined
    : getCoworkerInfoHref({ id: coworker.id, username: coworker.username });

  if (isMobile) {
    return (
      <CoworkerEditorMobileLayout
        activeTab={activeTab}
        status={status}
        showAdminTab={isAdmin}
        isRunDisabled={isRunDisabled}
        isRunning={isRunning}
        isDeleting={isDeleting}
        showDeleteDialog={showDeleteDialog}
        backHref={backHref}
        chatPanel={chatPanel}
        renderSettingsPanel={renderSettingsPanel}
        autoApproveDialog={autoApproveDialog}
        onTabChange={handleTabChange}
        onStatusChange={handleStatusChange}
        onRun={handleRunClick}
        onOpenDeleteDialog={handleOpenDeleteDialog}
        onShowDeleteDialogChange={setShowDeleteDialog}
        onDelete={handleDelete}
      />
    );
  }

  return (
    <CoworkerChatPanelBackHrefProvider backHref={backHref}>
      <CoworkerEditorDesktopLayout
        rightTitle={coworkerDisplayName}
        rightCollapsed={isInstructionPanelCollapsed}
        chatPanel={chatPanel}
        renderSettingsPanel={renderSettingsPanel}
        autoApproveDialog={autoApproveDialog}
        onRightCollapsedChange={setIsInstructionPanelCollapsed}
      />
    </CoworkerChatPanelBackHrefProvider>
  );
}
