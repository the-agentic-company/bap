"use client";

import {
  Circle,
  Download,
  Ellipsis,
  Loader2,
  PenLine,
  Pin,
  PinOff,
  Play,
  Share2,
  Tag,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent } from "@/components/animate-ui/components/radix/sheet";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { getCoworkerRunStatusLabel } from "@/lib/coworker-status";
import {
  COWORKER_AVAILABLE_INTEGRATION_TYPES,
  INTEGRATION_DISPLAY_NAMES,
  INTEGRATION_LOGOS,
  type IntegrationType,
} from "@/lib/integration-icons";
import { cn } from "@/lib/utils";
import {
  useDeleteCoworker,
  useExportCoworkerDefinition,
  useIntegrationList,
  useShareCoworker,
  useTriggerCoworker,
  useUnshareCoworker,
  useUpdateCoworker,
} from "@/orpc/hooks";
import {
  CoworkerCardContent,
  getCoworkerDisplayName,
  type CoworkerCardData,
} from "./coworker-card-content";
import { TagBadge } from "./tag-badge";
import { TagManagerContent } from "./tag-picker";

const MAX_VISIBLE_TOOL_INDICATORS = 3;

export type InteractiveCoworkerCardData = CoworkerCardData & {
  id: string;
  toolAccessMode?: "all" | "selected" | null;
  allowedIntegrations?: IntegrationType[];
  allowedSkillSlugs?: string[];
  isPinned?: boolean;
  tags?: { id: string; name: string; color: string | null }[];
};

function formatDate(value?: Date | string | null) {
  if (!value) {
    return null;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);
  if (diffMin < 1) {
    return "just now";
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  if (diffH < 24) {
    return `${diffH}h ago`;
  }
  if (diffD < 7) {
    return `${diffD}d ago`;
  }
  return date.toLocaleDateString();
}

function getRunStatusColor(status: string) {
  if (status === "completed") {
    return "text-emerald-500";
  }
  if (status === "running" || status === "awaiting_approval" || status === "awaiting_auth") {
    return "text-blue-500";
  }
  if (status === "paused") {
    return "text-amber-500";
  }
  if (status === "error" || status === "cancelled") {
    return "text-red-500";
  }
  return "text-muted-foreground";
}

function buildToolSummary(
  coworker: Pick<
    InteractiveCoworkerCardData,
    "toolAccessMode" | "allowedIntegrations" | "allowedSkillSlugs"
  >,
  connectedIntegrationTypes: IntegrationType[],
) {
  const integrationTypes =
    coworker.toolAccessMode === "all"
      ? connectedIntegrationTypes
      : (coworker.allowedIntegrations ?? []).filter((entry) =>
          COWORKER_AVAILABLE_INTEGRATION_TYPES.includes(entry),
        );
  const skillCount =
    coworker.toolAccessMode === "selected" ? (coworker.allowedSkillSlugs?.length ?? 0) : 0;
  const visibleIntegrations = integrationTypes.slice(0, MAX_VISIBLE_TOOL_INDICATORS);
  const remainingSlots = MAX_VISIBLE_TOOL_INDICATORS - visibleIntegrations.length;
  const showSkillBadge = skillCount > 0 && remainingSlots > 0;
  const coveredCount = visibleIntegrations.length + (showSkillBadge ? skillCount : 0);
  const totalCount = integrationTypes.length + skillCount;

  return {
    visibleIntegrations,
    skillCount,
    showSkillBadge,
    overflowCount: Math.max(0, totalCount - coveredCount),
  };
}

type RunEntry = { id: string; status: string; startedAt?: Date | string | null };

function RunsList({ runs }: { runs: RunEntry[] }) {
  return (
    <div className="flex flex-col">
      <div className="px-3 py-2">
        <p className="text-xs font-bold">Recent runs</p>
      </div>
      <div className="max-h-64 overflow-y-auto">
        {runs.map((run) => (
          <Link
            key={run.id}
            href={`/agents/runs/${run.id}`}
            className="hover:bg-muted/50 flex items-center gap-2.5 px-3 py-2 transition-colors"
          >
            <Circle
              className={cn("h-1.5 w-1.5 shrink-0 fill-current", getRunStatusColor(run.status))}
            />
            <span className="text-foreground/70 text-xs">
              {getCoworkerRunStatusLabel(run.status)}
            </span>
            <span className="text-muted-foreground ml-auto text-xs">
              {formatDate(run.startedAt) ?? "—"}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * Fully interactive coworker card with all controls.
 * Self-contained — manages its own mutations for run, status toggle, share, delete.
 * Used in both the main coworkers page and the org chart canvas.
 */
export function InteractiveCoworkerCard({
  coworker,
  className,
  onClick,
  nounLabel = "Coworker",
}: {
  coworker: InteractiveCoworkerCardData;
  className?: string;
  onClick?: () => void;
  nounLabel?: string;
}) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const { data: integrations } = useIntegrationList();
  const triggerCoworker = useTriggerCoworker();
  const updateCoworker = useUpdateCoworker();
  const deleteCoworkerMutation = useDeleteCoworker();
  const shareCoworker = useShareCoworker();
  const unshareCoworker = useUnshareCoworker();
  const exportCoworkerDefinition = useExportCoworkerDefinition();

  const [isRunning, setIsRunning] = useState(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [isUpdatingShare, setIsUpdatingShare] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);

  const isOn = coworker.status === "on";
  const recentRun = coworker.recentRuns?.[0];
  const hasRuns = Array.isArray(coworker.recentRuns) && coworker.recentRuns.length > 0;

  const connectedIntegrationTypes = useMemo(
    () => (integrations ?? []).map((i) => i.type as IntegrationType),
    [integrations],
  );

  const toolSummary = useMemo(
    () => buildToolSummary(coworker, connectedIntegrationTypes),
    [coworker, connectedIntegrationTypes],
  );

  const handleOpen = useCallback(() => {
    if (onClick) {
      onClick();
    } else {
      router.push(`/agents/${coworker.id}`);
    }
  }, [onClick, router, coworker.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Enter" && e.key !== " ") {
        return;
      }
      e.preventDefault();
      handleOpen();
    },
    [handleOpen],
  );

  const handleRun = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsRunning(true);
      try {
        const result = await triggerCoworker.mutateAsync({ id: coworker.id, payload: {} });
        toast.success(result.generationId ? "Run started." : "Needs your input.");
        router.push(result?.runId ? `/agents/runs/${result.runId}` : "/agents/runs");
      } catch {
        toast.error("Failed to start run.");
      } finally {
        setIsRunning(false);
      }
    },
    [triggerCoworker, coworker.id, router],
  );

  const handleToggleStatus = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const nextStatus = isOn ? "off" : "on";
      setIsUpdatingStatus(true);
      try {
        await updateCoworker.mutateAsync({ id: coworker.id, status: nextStatus });
        toast.success(`${nounLabel} turned ${nextStatus}.`);
      } catch {
        toast.error(`Failed to update ${nounLabel.toLowerCase()}.`);
      } finally {
        setIsUpdatingStatus(false);
      }
    },
    [updateCoworker, coworker.id, isOn, nounLabel],
  );

  const handleToggleShare = useCallback(async () => {
    setIsUpdatingShare(true);
    try {
      if (coworker.sharedAt) {
        await unshareCoworker.mutateAsync(coworker.id);
        toast.success(`${nounLabel} unshared.`);
      } else {
        await shareCoworker.mutateAsync(coworker.id);
        toast.success(`${nounLabel} shared with workspace.`);
      }
    } catch {
      toast.error("Failed to update sharing.");
    } finally {
      setIsUpdatingShare(false);
    }
  }, [shareCoworker, unshareCoworker, coworker.id, coworker.sharedAt, nounLabel]);

  const handleDelete = useCallback(async () => {
    try {
      await deleteCoworkerMutation.mutateAsync(coworker.id);
      toast.success(`${nounLabel} deleted.`);
    } catch {
      toast.error(`Failed to delete ${nounLabel.toLowerCase()}.`);
    } finally {
      setPendingDelete(false);
    }
  }, [deleteCoworkerMutation, coworker.id, nounLabel]);

  const handleStopPropagation = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation();
  }, []);

  const handleTogglePin = useCallback(async () => {
    try {
      await updateCoworker.mutateAsync({ id: coworker.id, isPinned: !coworker.isPinned });
      toast.success(coworker.isPinned ? "Unpinned." : "Pinned.");
    } catch {
      toast.error("Failed to update pin.");
    }
  }, [updateCoworker, coworker.id, coworker.isPinned]);

  const handleRequestDelete = useCallback(() => {
    setPendingDelete(true);
  }, []);

  const handleRunsTriggerClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleOpenRunsSheet = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setRunsOpen(true);
  }, []);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const definition = await exportCoworkerDefinition.mutateAsync(coworker.id);
      const json = JSON.stringify(definition, null, 2);
      const baseLabel = coworker.username?.trim() || coworker.name?.trim() || "coworker";
      const slug = baseLabel
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const filename = `${slug || "coworker"}.json`;
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${filename}.`);
    } catch {
      toast.error("Failed to export coworker.");
    } finally {
      setIsExporting(false);
    }
  }, [exportCoworkerDefinition, coworker.id, coworker.username, coworker.name]);

  const isDeleting = deleteCoworkerMutation.isPending;

  // oxlint-disable-next-line react-perf/jsx-no-jsx-as-prop -- slot pattern
  const statusButton = (
    <button
      type="button"
      onClick={handleToggleStatus}
      disabled={isUpdatingStatus || isDeleting}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
        "disabled:pointer-events-none disabled:opacity-50",
        isOn
          ? "border-green-500/20 bg-green-500/10 text-green-600 hover:bg-green-500/20 dark:text-green-400"
          : "border-border bg-muted/60 text-muted-foreground hover:bg-muted",
      )}
    >
      {isUpdatingStatus ? (
        <Loader2 className="size-2.5 animate-spin" />
      ) : (
        <span
          className={cn("size-2 rounded-full", isOn ? "bg-green-500" : "bg-muted-foreground/40")}
        />
      )}
      {isOn ? "On" : "Off"}
    </button>
  );

  const coworkerTags = coworker.tags ?? [];
  const currentTagIds = useMemo(() => (coworker.tags ?? []).map((tag) => tag.id), [coworker.tags]);

  const [menuPanel, setMenuPanel] = useState<"main" | "tags">("main");
  const handleMenuOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setMenuPanel("main");
    }
  }, []);
  const handleCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault();
  }, []);
  const handleOpenTagsPanel = useCallback((event: Event) => {
    event.preventDefault();
    setMenuPanel("tags");
  }, []);
  const handleBackToMainPanel = useCallback(() => {
    setMenuPanel("main");
  }, []);

  // oxlint-disable-next-line react-perf/jsx-no-jsx-as-prop -- slot pattern
  const actionsMenu = (
    <DropdownMenu onOpenChange={handleMenuOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={handleStopPropagation}
          className={cn(
            "text-muted-foreground hover:text-foreground hover:bg-muted inline-flex size-7 items-center justify-center rounded-md transition-colors",
            "opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100",
            "max-sm:opacity-100",
          )}
        >
          <Ellipsis className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-52"
        onClick={handleStopPropagation}
        onKeyDown={handleMenuKeyDown}
        onCloseAutoFocus={handleCloseAutoFocus}
      >
        {menuPanel === "main" ? (
          <>
            <DropdownMenuItem onSelect={handleTogglePin}>
              {coworker.isPinned ? (
                <>
                  <PinOff className="size-4" />
                  Unpin
                </>
              ) : (
                <>
                  <Pin className="size-4" />
                  Pin to top
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleOpenTagsPanel}>
              <Tag className="size-4" />
              Manage tags
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={handleToggleShare}
              disabled={isUpdatingShare || isDeleting || isUpdatingStatus}
            >
              <Share2 className="size-4" />
              {coworker.sharedAt ? "Unshare from workspace" : "Share with workspace"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={handleExport}
              disabled={isExporting || isDeleting || isUpdatingStatus}
            >
              <Download className="size-4" />
              Export as JSON
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={handleRequestDelete}
              disabled={isDeleting || isUpdatingStatus}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="size-4" />
              Delete coworker
            </DropdownMenuItem>
          </>
        ) : (
          <div onClick={handleStopPropagation} onKeyDown={handleMenuKeyDown}>
            <button
              type="button"
              onClick={handleBackToMainPanel}
              className="text-muted-foreground hover:text-foreground hover:bg-muted flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors"
            >
              ← Back
            </button>
            <DropdownMenuSeparator />
            <TagManagerContent coworkerId={coworker.id} currentTagIds={currentTagIds} />
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // oxlint-disable-next-line react-perf/jsx-no-jsx-as-prop -- slot pattern
  const toolBadges = (
    <>
      {coworkerTags.slice(0, 3).map((tag) => (
        <TagBadge key={tag.id} name={tag.name} color={tag.color} size="sm" />
      ))}
      {coworkerTags.length > 3 && (
        <span className="text-muted-foreground/60 text-[10px]">+{coworkerTags.length - 3}</span>
      )}
      {toolSummary.visibleIntegrations.length > 0 && (
        <div className="flex items-center gap-1">
          {toolSummary.visibleIntegrations.map((key) => {
            const logo = INTEGRATION_LOGOS[key];
            if (!logo) {
              return null;
            }
            return (
              <Image
                key={key}
                src={logo}
                alt={INTEGRATION_DISPLAY_NAMES[key] ?? key}
                width={14}
                height={14}
                className="size-3.5 shrink-0"
                title={INTEGRATION_DISPLAY_NAMES[key] ?? key}
              />
            );
          })}
        </div>
      )}
      {toolSummary.showSkillBadge ? (
        <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
          {toolSummary.skillCount} skill{toolSummary.skillCount === 1 ? "" : "s"}
        </span>
      ) : null}
      {toolSummary.overflowCount > 0 ? (
        <span className="text-muted-foreground inline-flex items-center text-[10px] font-medium">
          +{toolSummary.overflowCount}
        </span>
      ) : null}
    </>
  );

  // oxlint-disable-next-line react-perf/jsx-no-jsx-as-prop -- slot pattern
  const runsSection = hasRuns ? (
    isMobile ? (
      <Sheet open={runsOpen} onOpenChange={setRunsOpen}>
        <button
          type="button"
          onClick={handleOpenRunsSheet}
          className="text-muted-foreground/70 hover:text-foreground text-left text-xs transition-colors"
        >
          {recentRun ? (
            <span>
              Last run:{" "}
              <span className="text-muted-foreground">
                {getCoworkerRunStatusLabel(recentRun.status)}
              </span>{" "}
              · {formatDate(recentRun.startedAt) ?? "—"}
            </span>
          ) : null}
        </button>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          title={`${getCoworkerDisplayName(coworker.name)} runs`}
          className="h-auto max-h-[60vh]"
        >
          <RunsList runs={coworker.recentRuns as RunEntry[]} />
        </SheetContent>
      </Sheet>
    ) : (
      <Popover open={runsOpen} onOpenChange={setRunsOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={handleRunsTriggerClick}
            className="text-muted-foreground/70 hover:text-foreground text-left text-xs transition-colors"
          >
            {recentRun ? (
              <span>
                Last run:{" "}
                <span className="text-muted-foreground">
                  {getCoworkerRunStatusLabel(recentRun.status)}
                </span>{" "}
                · {formatDate(recentRun.startedAt) ?? "—"}
              </span>
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0" onClick={handleStopPropagation}>
          <RunsList runs={coworker.recentRuns as RunEntry[]} />
        </PopoverContent>
      </Popover>
    )
  ) : undefined;

  // oxlint-disable-next-line react-perf/jsx-no-jsx-as-prop -- slot pattern
  const footer = (
    <div className="mt-auto flex items-center justify-between pt-3">
      <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
        {nounLabel}
      </span>
      <div className="flex items-center gap-0.5">
        <Link
          href={`/agents/${coworker.id}`}
          onClick={handleStopPropagation}
          className="text-muted-foreground/30 hover:text-foreground group-hover:text-muted-foreground hover:bg-muted inline-flex size-7 items-center justify-center rounded-md transition-colors"
          title="Edit coworker"
        >
          <PenLine className="size-3.5" />
        </Link>
        <button
          type="button"
          onClick={handleRun}
          disabled={isRunning || isDeleting}
          className="text-muted-foreground/30 hover:text-foreground group-hover:text-muted-foreground hover:bg-muted inline-flex size-7 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-50"
          title="Run coworker"
        >
          {isRunning ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div
        tabIndex={0}
        onClick={handleOpen}
        onKeyDown={handleKeyDown}
        className={cn(
          "border-border bg-card hover:border-foreground/30 hover:bg-muted/30 group flex h-full min-h-[180px] cursor-pointer flex-col gap-3 rounded-xl border p-5 transition-all duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
          className,
        )}
      >
        <CoworkerCardContent
          coworker={coworker}
          statusSlot={statusButton}
          actionsSlot={actionsMenu}
          badgesSlot={toolBadges}
          runsSlot={runsSection}
          footerSlot={footer}
        />
      </div>

      <AlertDialog open={pendingDelete} onOpenChange={setPendingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {nounLabel.toLowerCase()}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {getCoworkerDisplayName(coworker.name)}? This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
