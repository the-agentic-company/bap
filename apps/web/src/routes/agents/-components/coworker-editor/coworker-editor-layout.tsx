import type { ReactNode } from "react";
import { T, useGT } from "gt-react";
import {
  ArrowLeft,
  CirclePlay,
  FileText,
  Loader2,
  MessageSquare,
  Pencil,
  Shield,
  Trash2,
  Wrench,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DualPanelWorkspace } from "@/components/ui/dual-panel-workspace";
import { Switch } from "@/components/ui/switch";
import { AnimatedTab, AnimatedTabs } from "@/components/ui/tabs";
import { AppLink as Link } from "../../-lib/app-link";
import type { CoworkerTab } from "./types";

function BackToRunLink({
  href,
  label,
}: {
  href: string | undefined;
  label: string;
}) {
  if (!href) {
    return null;
  }
  return (
    <Link
      href={href}
      className="text-muted-foreground hover:text-foreground hover:bg-muted flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors"
      aria-label={label}
    >
      <ArrowLeft className="h-4 w-4" />
    </Link>
  );
}

type CoworkerEditorMobileLayoutProps = {
  activeTab: CoworkerTab;
  status: "on" | "off";
  showAdminTab: boolean;
  isRunDisabled: boolean;
  isRunning: boolean;
  isDeleting: boolean;
  showDeleteDialog: boolean;
  backHref?: string;
  chatPanel: ReactNode;
  renderSettingsPanel: (options?: { hideHeader?: boolean }) => ReactNode;
  autoApproveDialog: ReactNode;
  onTabChange: (key: string) => void;
  onStatusChange: (checked: boolean) => void;
  onRun: (event: React.MouseEvent) => void;
  onOpenDeleteDialog: () => void;
  onShowDeleteDialogChange: (open: boolean) => void;
  onDelete: () => void;
};

export function CoworkerEditorMobileLayout({
  activeTab,
  status,
  showAdminTab,
  isRunDisabled,
  isRunning,
  isDeleting,
  showDeleteDialog,
  backHref,
  chatPanel,
  renderSettingsPanel,
  autoApproveDialog,
  onTabChange,
  onStatusChange,
  onRun,
  onOpenDeleteDialog,
  onShowDeleteDialogChange,
  onDelete,
}: CoworkerEditorMobileLayoutProps) {
  const t = useGT();
  const settingsPanel = renderSettingsPanel({ hideHeader: true });

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="bg-background/95 border-border/60 flex items-center justify-between gap-2 border-b px-3 py-2 backdrop-blur-sm">
        <BackToRunLink href={backHref} label={t("Back to run view")} />
        <AnimatedTabs
          activeKey={activeTab}
          onTabChange={onTabChange}
          className="gap-0"
        >
          <AnimatedTab value="chat" className="px-2.5">
            <MessageSquare className="h-4 w-4" aria-label={t("Chat")} />
          </AnimatedTab>
          <AnimatedTab value="instruction" className="px-2.5">
            <Pencil className="h-4 w-4" aria-label={t("Instruction")} />
          </AnimatedTab>
          <AnimatedTab value="docs" className="px-2.5">
            <FileText className="h-4 w-4" aria-label={t("Docs")} />
          </AnimatedTab>
          <AnimatedTab value="toolbox" className="px-2.5">
            <Wrench className="h-4 w-4" aria-label={t("Toolbox")} />
          </AnimatedTab>
          {showAdminTab ? (
            <AnimatedTab value="admin" className="px-2.5">
              <Shield className="h-4 w-4" aria-label={t("Admin")} />
            </AnimatedTab>
          ) : null}
        </AnimatedTabs>
        <div className="flex shrink-0 items-center gap-1.5">
          <Switch checked={status === "on"} onCheckedChange={onStatusChange} />
          <button
            type="button"
            onClick={onRun}
            disabled={isRunDisabled}
            className="text-muted-foreground hover:text-foreground hover:bg-muted flex h-8 w-8 items-center justify-center rounded-xl transition-colors disabled:opacity-40"
            aria-label={t("Run now")}
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CirclePlay className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={onOpenDeleteDialog}
            className="text-muted-foreground hover:text-destructive hover:bg-muted flex h-8 w-8 items-center justify-center rounded-xl transition-colors"
            aria-label={t("Delete coworker")}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === "chat" ? chatPanel : settingsPanel}
      </div>
      {autoApproveDialog}
      <DeleteCoworkerDialog
        open={showDeleteDialog}
        isDeleting={isDeleting}
        onOpenChange={onShowDeleteDialogChange}
        onDelete={onDelete}
      />
    </div>
  );
}

type CoworkerEditorDesktopLayoutProps = {
  rightTitle: string;
  rightCollapsed: boolean;
  chatPanel: ReactNode;
  renderSettingsPanel: () => ReactNode;
  autoApproveDialog: ReactNode;
  onRightCollapsedChange: (collapsed: boolean) => void;
};

export function CoworkerEditorDesktopLayout({
  rightTitle,
  rightCollapsed,
  chatPanel,
  renderSettingsPanel,
  autoApproveDialog,
  onRightCollapsedChange,
}: CoworkerEditorDesktopLayoutProps) {
  const settingsPanel = renderSettingsPanel();

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <DualPanelWorkspace
        storageKey="coworker-editor-panels-v2"
        defaultRightWidth={50}
        minRightWidth={50}
        collapsible
        collapsedSidebar
        showExpandedCollapseButton={false}
        showTitles={false}
        rightCollapsed={rightCollapsed}
        onRightCollapsedChange={onRightCollapsedChange}
        leftTitle="Chat"
        rightTitle={rightTitle}
        leftPanelClassName="border-0 rounded-none bg-background"
        separatorClassName="bg-muted/30"
        rightPanelClassName="border-0 rounded-xl bg-card md:min-w-[34rem]"
        left={chatPanel}
        right={settingsPanel}
        hideMobileToggle
      />
      {autoApproveDialog}
    </div>
  );
}

export function DisableAutoApproveDialog({
  open,
  onOpenChange,
  onDisable,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDisable: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <T>Turn off auto-approve?</T>
          </AlertDialogTitle>
          <AlertDialogDescription>
            <T>
              If you turn this off, coworker runs can stop and wait for manual
              approval on write actions. The coworker might stay stuck until
              someone approves in the UI.
            </T>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <T>Keep on</T>
          </AlertDialogCancel>
          <AlertDialogAction onClick={onDisable}>
            <T>Turn off</T>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteCoworkerDialog({
  open,
  isDeleting,
  onOpenChange,
  onDelete,
}: {
  open: boolean;
  isDeleting: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <T>Delete coworker?</T>
          </AlertDialogTitle>
          <AlertDialogDescription>
            <T>
              This will permanently delete this coworker and all of its run
              history. This action cannot be undone.
            </T>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <T>Cancel</T>
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onDelete}
            disabled={isDeleting}
            className="bg-destructive hover:bg-destructive/90 text-white"
          >
            {isDeleting ? (
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            ) : null}
            <T>Delete</T>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
