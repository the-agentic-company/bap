import type { CoworkerToolAccessMode } from "@bap/core/lib/coworker-tool-policy";
import { T } from "gt-react";
import { Download, Eye, Loader2 } from "lucide-react";
import { useCallback, useMemo } from "react";
import { CoworkerAvatar } from "@/components/coworker-avatar";
import { getCoworkerDisplayName } from "@/components/coworkers/coworker-card-content";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  COWORKER_AVAILABLE_INTEGRATION_TYPES,
  INTEGRATION_DISPLAY_NAMES,
  INTEGRATION_LOGOS,
  type IntegrationType,
} from "@/lib/integration-icons";
import { AppImage as Image } from "../-lib/app-image";

export type SharedCoworkerItem = {
  id: string;
  name?: string | null;
  description?: string | null;
  folderId?: string | null;
  triggerType: string;
  toolAccessMode: CoworkerToolAccessMode;
  allowedIntegrations?: IntegrationType[];
  allowedSkillSlugs?: string[];
  prompt?: string | null;
  owner: {
    name?: string | null;
    email?: string | null;
  };
  sharedAt?: Date | string | null;
  documentCount: number;
  isOwnedByCurrentUser: boolean;
};

const MAX_VISIBLE_TOOL_INDICATORS = 3;

function formatDate(value?: Date | string | null) {
  if (!value) {
    return null;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
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

function getTriggerLabel(triggerType: string) {
  const map: Record<string, string> = {
    manual: "Manual",
    schedule: "Scheduled",
    email: "Email",
    webhook: "Webhook",
  };
  return map[triggerType] ?? triggerType;
}

function buildToolSummary(
  coworker: {
    toolAccessMode: CoworkerToolAccessMode;
    allowedIntegrations?: IntegrationType[];
    allowedSkillSlugs?: string[];
  },
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

export function SharedCoworkerCard({
  coworker,
  connectedIntegrationTypes,
  isImporting,
  onImport,
}: {
  coworker: SharedCoworkerItem;
  connectedIntegrationTypes: IntegrationType[];
  isImporting: boolean;
  onImport: (id: string) => void;
}) {
  const handleImport = useCallback(() => {
    onImport(coworker.id);
  }, [coworker.id, onImport]);

  const toolSummary = useMemo(
    () => buildToolSummary(coworker, connectedIntegrationTypes),
    [connectedIntegrationTypes, coworker],
  );

  return (
    <div className="border-border bg-card flex h-full min-h-[160px] flex-col gap-3 rounded-xl border p-5">
      <div className="flex items-start gap-3">
        <CoworkerAvatar username={coworker.name} size={36} className="rounded-full" />
        <div className="space-y-1">
          <p className="text-sm leading-tight font-medium">
            {getCoworkerDisplayName(coworker.name)}
          </p>
          <p className="text-muted-foreground text-xs">
            <T>Shared by</T> {coworker.owner.name?.trim() || coworker.owner.email || "A teammate"}
          </p>
        </div>
      </div>
      {coworker.description ? (
        <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
          {coworker.description}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
          {getTriggerLabel(coworker.triggerType)}
        </span>
        {toolSummary.visibleIntegrations.length > 0 ? (
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
        ) : null}
        {toolSummary.showSkillBadge ? (
          <span className="bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium">
            {toolSummary.skillCount} <T>skill</T>
            {toolSummary.skillCount === 1 ? "" : "s"}
          </span>
        ) : null}
        {toolSummary.overflowCount > 0 ? (
          <span className="text-muted-foreground inline-flex items-center text-[10px] font-medium">
            +{toolSummary.overflowCount}
          </span>
        ) : null}
      </div>

      <div className="text-muted-foreground/70 text-xs">
        {coworker.documentCount} <T>document</T>
        {coworker.documentCount === 1 ? "" : "s"} <T>· shared</T>{" "}
        {formatDate(coworker.sharedAt) ?? "recently"}
      </div>
      <div className="mt-auto flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={handleImport}
          disabled={isImporting}
        >
          {isImporting ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Download className="size-3" />
          )}
          <T>Install</T>
        </Button>
        {coworker.prompt ? (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                <Eye className="size-3" />
                <T>View instructions</T>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{getCoworkerDisplayName(coworker.name)}</DialogTitle>
                <DialogDescription>
                  <T>Instructions shared by</T>{" "}
                  {coworker.owner.name?.trim() || coworker.owner.email || "a teammate"}
                </DialogDescription>
              </DialogHeader>
              <div className="text-muted-foreground max-h-[400px] overflow-y-auto text-sm whitespace-pre-wrap">
                {coworker.prompt}
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </div>
  );
}
