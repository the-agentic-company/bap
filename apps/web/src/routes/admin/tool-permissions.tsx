import type { WorkspaceIntegrationPolicySubject } from "@bap/core/server/services/workspace-integration-policy";
import type {
  WorkspaceIntegrationOperationRestriction,
  WorkspaceIntegrationPolicyMode,
} from "@bap/integration-policy";
import { createFileRoute } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { ChevronDown, Loader2 } from "lucide-react";
import { type MouseEvent, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { WorkspaceMcpServerLogo } from "@/components/executor-source-logo";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INTEGRATION_LOGOS } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";
import {
  useDiscoverWorkspaceMcpTools,
  useReplaceWorkspaceIntegrationPolicy,
  useWorkspaceIntegrationPolicies,
} from "@/orpc/hooks/workspace-integration-policy";

export const Route = createFileRoute("/admin/tool-permissions")({
  head: () => ({ meta: [{ title: "Workspace Tool Permissions - Bap" }] }),
  component: WorkspaceToolPermissionsPage,
});

const MODES: Array<{ value: WorkspaceIntegrationPolicyMode; label: string }> = [
  { value: "auto_approved", label: "Auto-approved" },
  { value: "requires_approval", label: "Requires approval" },
  { value: "denied", label: "Denied" },
  { value: "personalized", label: "Personalized" },
];

const OPERATION_STATES: Array<{
  value: "auto_approved" | WorkspaceIntegrationOperationRestriction;
  label: string;
}> = [
  { value: "auto_approved", label: "Auto-approved" },
  { value: "requires_approval", label: "Requires approval" },
  { value: "denied", label: "Denied" },
];

type PolicyOperation = {
  key: string;
  label: string;
  description?: string | null;
  available?: boolean;
  firstSeenAt?: Date | string;
  lastSeenAt?: Date | string;
  restriction: WorkspaceIntegrationOperationRestriction | null;
};

type PolicyGroup = {
  subject: WorkspaceIntegrationPolicySubject;
  displayName?: string;
  name?: string;
  namespace?: string;
  endpoint?: string;
  mode: WorkspaceIntegrationPolicyMode;
  explicit: boolean;
  available?: boolean;
  operations: PolicyOperation[];
};

function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("bg-muted animate-pulse rounded-md", className)} />;
}

function isNewOperation(operation: PolicyOperation): boolean {
  return operation.firstSeenAt
    ? Date.now() - new Date(operation.firstSeenAt).getTime() < 24 * 60 * 60 * 1000
    : false;
}

function PolicyLogo({ group, title }: { group: PolicyGroup; title: string }) {
  if (group.subject.kind === "workspace_mcp_server") {
    return (
      <WorkspaceMcpServerLogo
        kind="mcp"
        endpoint={group.endpoint ?? ""}
        className="h-9 w-9 shrink-0"
        imgClassName="rounded-md"
      />
    );
  }

  return (
    <span className="bg-background flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border">
      <img
        src={INTEGRATION_LOGOS[group.subject.integrationType]}
        alt=""
        className="h-5 w-5 object-contain"
      />
      <span className="sr-only">{title}</span>
    </span>
  );
}

function OperationPolicyRow({
  operation,
  value,
  disabled,
  onChange,
}: {
  operation: PolicyOperation;
  value: "auto_approved" | WorkspaceIntegrationOperationRestriction;
  disabled: boolean;
  onChange: (operationKey: string, value: string) => void;
}) {
  const handleChange = useCallback(
    (nextValue: string) => onChange(operation.key, nextValue),
    [onChange, operation.key],
  );

  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_168px] sm:items-center sm:gap-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{operation.label}</span>
          {isNewOperation(operation) ? (
            <span className="bg-brand-light text-brand-dark rounded-full px-2 py-0.5 text-[11px]">
              New
            </span>
          ) : null}
          {operation.available === false ? (
            <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[11px]">
              Last known
            </span>
          ) : null}
        </div>
        <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
          {operation.description ?? operation.key}
        </p>
      </div>
      <Select value={value} onValueChange={handleChange} disabled={disabled}>
        <SelectTrigger aria-label={`${operation.label} policy`} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {OPERATION_STATES.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function PolicyGroupRow({
  group,
  canEdit,
  saving,
  onSave,
}: {
  group: PolicyGroup;
  canEdit: boolean;
  saving: boolean;
  onSave: (
    group: PolicyGroup,
    mode: WorkspaceIntegrationPolicyMode,
    restrictions: Array<{
      operationKey: string;
      restriction: WorkspaceIntegrationOperationRestriction;
    }>,
  ) => Promise<void>;
}) {
  const title = group.displayName ?? group.name ?? "Integration";
  const [mode, setMode] = useState(group.mode);
  const [restrictions, setRestrictions] = useState<
    Record<string, WorkspaceIntegrationOperationRestriction>
  >(
    Object.fromEntries(
      group.operations.flatMap((operation) =>
        operation.restriction ? [[operation.key, operation.restriction]] : [],
      ),
    ),
  );

  useEffect(() => {
    setMode(group.mode);
    setRestrictions(
      Object.fromEntries(
        group.operations.flatMap((operation) =>
          operation.restriction ? [[operation.key, operation.restriction]] : [],
        ),
      ),
    );
  }, [group.mode, group.operations]);

  const handleModeChange = useCallback(
    async (value: string) => {
      const nextMode = value as WorkspaceIntegrationPolicyMode;
      const previousMode = mode;
      const previousRestrictions = restrictions;
      const nextRestrictions = nextMode === "personalized" ? restrictions : {};
      setMode(nextMode);
      setRestrictions(nextRestrictions);
      try {
        await onSave(
          group,
          nextMode,
          Object.entries(nextRestrictions).map(([operationKey, restriction]) => ({
            operationKey,
            restriction,
          })),
        );
      } catch {
        setMode(previousMode);
        setRestrictions(previousRestrictions);
      }
    },
    [group, mode, onSave, restrictions],
  );

  const handleOperationChange = useCallback(
    async (operationKey: string, value: string) => {
      const previousMode = mode;
      const previousRestrictions = restrictions;
      const next = { ...restrictions };
      if (value === "auto_approved") {
        delete next[operationKey];
      } else {
        next[operationKey] = value as WorkspaceIntegrationOperationRestriction;
      }
      setMode("personalized");
      setRestrictions(next);
      try {
        await onSave(
          group,
          "personalized",
          Object.entries(next).map(([key, restriction]) => ({
            operationKey: key,
            restriction,
          })),
        );
      } catch {
        setMode(previousMode);
        setRestrictions(previousRestrictions);
      }
    },
    [group, mode, onSave, restrictions],
  );

  const handleSelectClick = useCallback((event: MouseEvent) => {
    event.stopPropagation();
  }, []);
  const operationEditingEnabled =
    canEdit && !saving && (mode === "auto_approved" || mode === "personalized");
  const operationCountLabel =
    group.subject.kind === "integration"
      ? `${group.operations.length} operations`
      : `${group.operations.length} tools`;
  const scopeLabel =
    group.subject.kind === "integration"
      ? "All Connected Accounts"
      : (group.namespace ?? "Workspace MCP Server");

  return (
    <details className="group border-b last:border-b-0">
      <summary className="focus-visible:ring-ring grid cursor-pointer list-none grid-cols-[16px_36px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-inset sm:grid-cols-[16px_36px_minmax(0,1fr)_168px] [&::-webkit-details-marker]:hidden">
        <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0 transition-transform duration-150 ease-out group-open:rotate-180" />
        <PolicyLogo group={group} title={title} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold">{title}</span>
            {saving ? <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" /> : null}
            {group.available === false ? (
              <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[11px]">
                Unavailable
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {scopeLabel} · {operationCountLabel}
          </p>
        </div>
        <Select value={mode} onValueChange={handleModeChange} disabled={!canEdit || saving}>
          <SelectTrigger
            aria-label={`${title} policy`}
            className="col-span-2 col-start-2 w-full sm:col-span-1 sm:col-start-4 sm:w-[168px]"
            onClick={handleSelectClick}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {MODES.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </summary>

      <div className="bg-muted/20 border-t">
        <div className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_168px] gap-6 border-b px-4 py-2 text-[11px] font-medium tracking-wide uppercase">
          <span>Operation</span>
          <span>Policy</span>
        </div>
        {group.operations.length > 0 ? (
          <div className="divide-y">
            {group.operations.map((operation) => {
              const value =
                mode === "personalized"
                  ? (restrictions[operation.key] ?? "auto_approved")
                  : mode === "auto_approved"
                    ? "auto_approved"
                    : mode;
              return (
                <OperationPolicyRow
                  key={operation.key}
                  operation={operation}
                  value={value}
                  disabled={!operationEditingEnabled}
                  onChange={handleOperationChange}
                />
              );
            })}
          </div>
        ) : (
          <p className="text-muted-foreground px-4 py-4 text-sm">No operations reported.</p>
        )}
      </div>
    </details>
  );
}

function PolicySection({
  title,
  description,
  groups,
  canEdit,
  savingSubject,
  syncing,
  workspaceId,
  onSave,
}: {
  title: string;
  description: string;
  groups: PolicyGroup[];
  canEdit: boolean;
  savingSubject: string | null;
  syncing?: boolean;
  workspaceId: string;
  onSave: Parameters<typeof PolicyGroupRow>[0]["onSave"];
}) {
  return (
    <section aria-labelledby={`${title.toLowerCase().replaceAll(" ", "-")}-heading`}>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h3
            id={`${title.toLowerCase().replaceAll(" ", "-")}-heading`}
            className="text-sm font-semibold"
          >
            {title}
          </h3>
          <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>
        </div>
        <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {syncing ? "Discovering" : groups.length}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border">
        {groups.map((group) => {
          const key =
            group.subject.kind === "integration"
              ? `integration:${group.subject.integrationType}`
              : `workspace_mcp_server:${group.subject.workspaceMcpServerId}`;
          return (
            <PolicyGroupRow
              key={`${workspaceId}:${key}`}
              group={group}
              canEdit={canEdit}
              saving={savingSubject === key}
              onSave={onSave}
            />
          );
        })}
      </div>
    </section>
  );
}

function PolicyPageSkeleton() {
  return (
    <div className="max-w-5xl space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-[34rem] max-w-full" />
      </div>
      {[1, 2].map((section) => (
        <div key={section} className="space-y-3">
          <Skeleton className="h-4 w-36" />
          <div className="overflow-hidden rounded-lg border">
            {[1, 2, 3].map((row) => (
              <div key={row} className="flex items-center gap-3 border-b p-4 last:border-b-0">
                <Skeleton className="h-9 w-9 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-9 w-40" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkspaceToolPermissionsPage() {
  const t = useGT();
  const { sessionContext } = Route.useRouteContext();
  const workspaceId = sessionContext.principal?.activeWorkspaceId ?? "";
  const { data, isLoading, error } = useWorkspaceIntegrationPolicies(workspaceId);
  const discoverMcpTools = useDiscoverWorkspaceMcpTools(workspaceId);
  const replacePolicy = useReplaceWorkspaceIntegrationPolicy(workspaceId);
  const [savingSubject, setSavingSubject] = useState<string | null>(null);

  const handleSave = useCallback(
    async (
      group: PolicyGroup,
      mode: WorkspaceIntegrationPolicyMode,
      restrictions: Array<{
        operationKey: string;
        restriction: WorkspaceIntegrationOperationRestriction;
      }>,
    ) => {
      const subjectKey =
        group.subject.kind === "integration"
          ? `integration:${group.subject.integrationType}`
          : `workspace_mcp_server:${group.subject.workspaceMcpServerId}`;
      setSavingSubject(subjectKey);
      try {
        await replacePolicy.mutateAsync({ subject: group.subject, mode, restrictions });
        toast.success(t(`${group.displayName ?? group.name ?? "Integration"} policy updated.`));
      } catch (saveError) {
        toast.error(
          saveError instanceof Error ? saveError.message : t("Failed to update the policy."),
        );
        throw saveError;
      } finally {
        setSavingSubject(null);
      }
    },
    [replacePolicy, t],
  );

  if (isLoading) {
    return <PolicyPageSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="max-w-5xl rounded-lg border p-5">
        <p className="text-sm font-medium">Tool permissions could not be loaded.</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {error instanceof Error ? error.message : "Try refreshing this page."}
        </p>
      </div>
    );
  }

  const integrations: PolicyGroup[] = data.catalog.managedIntegrations;
  const mcpServers: PolicyGroup[] = data.catalog.workspaceMcpServers;

  return (
    <div className="max-w-5xl space-y-8">
      <header>
        <h2 className="text-xl font-semibold">
          <T>Workspace tool permissions</T>
        </h2>
        <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
          <T>
            Control how agents use connected tools across this workspace. Operation changes create a
            Personalized policy automatically.
          </T>
        </p>
      </header>

      {!data.canEdit ? (
        <p className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-sm">
          <T>You can review these policies. A Workspace owner or admin can change them.</T>
        </p>
      ) : null}

      <PolicySection
        title="Integration Types"
        description="Each policy applies to every Connected Account of that Integration Type."
        groups={integrations}
        canEdit={data.canEdit}
        savingSubject={savingSubject}
        workspaceId={workspaceId}
        onSave={handleSave}
      />

      {mcpServers.length > 0 ? (
        <PolicySection
          title="Workspace MCP Servers"
          description="Tools are discovered automatically from enabled servers."
          groups={mcpServers}
          canEdit={data.canEdit}
          savingSubject={savingSubject}
          syncing={discoverMcpTools.isFetching}
          workspaceId={workspaceId}
          onSave={handleSave}
        />
      ) : null}
    </div>
  );
}
