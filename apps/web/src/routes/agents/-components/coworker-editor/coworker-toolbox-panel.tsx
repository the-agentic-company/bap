import { T } from "gt-react";
import { ArrowRight, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { useCallback } from "react";
import { Switch } from "@/components/ui/switch";
import type { IntegrationType } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";
import { AppImage as Image } from "../../-lib/app-image";
import { AppLink as Link } from "../../-lib/app-link";
import type { AvailableSkillEntry, IntegrationEntry, WorkspaceMcpServerEntry } from "./types";

const toolboxRevealInitial = { opacity: 0, y: -4 } as const;
const toolboxRevealAnimate = { opacity: 1, y: 0 } as const;
const toolboxRevealTransition = { duration: 0.15 } as const;

type CoworkerToolboxPanelProps = {
  restrictTools: boolean;
  allowedIntegrations: IntegrationType[];
  allIntegrationTypes: IntegrationType[];
  integrationEntries: IntegrationEntry[];
  availableSkills: AvailableSkillEntry[];
  selectedSkillKeys: string[];
  workspaceMcpServerEntries: WorkspaceMcpServerEntry[];
  selectedWorkspaceMcpServerIds: string[];
  isSkillsLoading: boolean;
  onRestrictToolsChange: (checked: boolean) => void;
  onSelectAllIntegrations: () => void;
  onClearIntegrations: () => void;
  onToggleIntegrationChecked: (type: IntegrationType) => void;
  onClearSkills: () => void;
  onToggleSkillChecked: (skillKey: string) => void;
  onClearWorkspaceMcpServers: () => void;
  onToggleWorkspaceMcpServerChecked: (sourceId: string) => void;
};

export function CoworkerToolboxPanel({
  restrictTools,
  allowedIntegrations,
  allIntegrationTypes,
  integrationEntries,
  availableSkills,
  selectedSkillKeys,
  workspaceMcpServerEntries,
  selectedWorkspaceMcpServerIds,
  isSkillsLoading,
  onRestrictToolsChange,
  onSelectAllIntegrations,
  onClearIntegrations,
  onToggleIntegrationChecked,
  onClearSkills,
  onToggleSkillChecked,
  onClearWorkspaceMcpServers,
  onToggleWorkspaceMcpServerChecked,
}: CoworkerToolboxPanelProps) {
  const handleIntegrationButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const integrationType = event.currentTarget.dataset.integrationType as
        | IntegrationType
        | undefined;
      if (!integrationType) {
        return;
      }
      onToggleIntegrationChecked(integrationType);
    },
    [onToggleIntegrationChecked],
  );

  const handleSkillButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const skillKey = event.currentTarget.dataset.skillKey;
      if (!skillKey) {
        return;
      }
      onToggleSkillChecked(skillKey);
    },
    [onToggleSkillChecked],
  );

  const handleWorkspaceMcpServerButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const sourceId = event.currentTarget.dataset.executorSourceId;
      if (!sourceId) {
        return;
      }
      onToggleWorkspaceMcpServerChecked(sourceId);
    },
    [onToggleWorkspaceMcpServerChecked],
  );

  return (
    <div className="space-y-5 px-4 py-3">
      <div className="border-border/40 bg-muted/20 flex items-center justify-between gap-3 rounded-lg border px-4 py-3">
        <div className="space-y-0.5">
          <span className="text-sm font-medium">
            <T>All tools allowed</T>
          </span>
          <p className="text-muted-foreground text-[11px]">
            <T>When enabled, this coworker can use any connected tool</T>
          </p>
        </div>
        <Switch checked={!restrictTools} onCheckedChange={onRestrictToolsChange} />
      </div>

      {restrictTools && (
        <motion.div
          initial={toolboxRevealInitial}
          animate={toolboxRevealAnimate}
          transition={toolboxRevealTransition}
          className="space-y-5"
        >
          <IntegrationSelection
            allowedIntegrations={allowedIntegrations}
            allIntegrationTypes={allIntegrationTypes}
            integrationEntries={integrationEntries}
            onSelectAllIntegrations={onSelectAllIntegrations}
            onClearIntegrations={onClearIntegrations}
            onIntegrationButtonClick={handleIntegrationButtonClick}
          />
          <WorkspaceMcpServerSelection
            selectedWorkspaceMcpServerIds={selectedWorkspaceMcpServerIds}
            workspaceMcpServerEntries={workspaceMcpServerEntries}
            onClearWorkspaceMcpServers={onClearWorkspaceMcpServers}
            onWorkspaceMcpServerButtonClick={handleWorkspaceMcpServerButtonClick}
          />
          <SkillSelection
            availableSkills={availableSkills}
            selectedSkillKeys={selectedSkillKeys}
            isSkillsLoading={isSkillsLoading}
            onClearSkills={onClearSkills}
            onSkillButtonClick={handleSkillButtonClick}
          />
        </motion.div>
      )}

      <Link
        href="/toolbox"
        className="border-border/40 bg-card hover:bg-muted/30 hover:border-border/70 flex items-center justify-between rounded-lg border px-4 py-3 text-sm font-medium transition-colors"
      >
        <span className="text-muted-foreground">
          <T>Manage in Toolbox</T>
        </span>
        <ArrowRight className="text-muted-foreground h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

function IntegrationSelection({
  allowedIntegrations,
  allIntegrationTypes,
  integrationEntries,
  onSelectAllIntegrations,
  onClearIntegrations,
  onIntegrationButtonClick,
}: {
  allowedIntegrations: IntegrationType[];
  allIntegrationTypes: IntegrationType[];
  integrationEntries: IntegrationEntry[];
  onSelectAllIntegrations: () => void;
  onClearIntegrations: () => void;
  onIntegrationButtonClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          <T>Integrations</T>
        </h3>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onSelectAllIntegrations}
            disabled={allowedIntegrations.length === allIntegrationTypes.length}
            className="text-muted-foreground hover:text-foreground text-[10px] font-medium transition-colors disabled:opacity-40"
          >
            <T>All</T>
          </button>
          <span className="text-muted-foreground/30 text-[10px]">.</span>
          <button
            type="button"
            onClick={onClearIntegrations}
            disabled={allowedIntegrations.length === 0}
            className="text-muted-foreground hover:text-foreground text-[10px] font-medium transition-colors disabled:opacity-40"
          >
            <T>None</T>
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {integrationEntries.map(({ key, name: label, logo }) => {
          const isActive = allowedIntegrations.includes(key);
          return (
            <button
              key={key}
              type="button"
              data-integration-type={key}
              onClick={onIntegrationButtonClick}
              className={cn(
                "group relative flex items-center gap-2.5 rounded-lg border p-3 text-left transition-all duration-150",
                isActive
                  ? "border-primary/30 bg-primary/5 shadow-sm"
                  : "border-border/40 bg-card hover:border-border/70 opacity-60 hover:opacity-100",
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-white p-1 dark:bg-gray-800",
                  isActive ? "border-primary/20 shadow-sm" : "border-border/40",
                )}
              >
                <Image
                  src={logo}
                  alt={label}
                  width={16}
                  height={16}
                  className="h-4 w-4 object-contain"
                />
              </div>
              <ToolboxItemLabel
                title={label}
                statusLabel={isActive ? "On" : "Off"}
                isActive={isActive}
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function WorkspaceMcpServerSelection({
  selectedWorkspaceMcpServerIds,
  workspaceMcpServerEntries,
  onClearWorkspaceMcpServers,
  onWorkspaceMcpServerButtonClick,
}: {
  selectedWorkspaceMcpServerIds: string[];
  workspaceMcpServerEntries: WorkspaceMcpServerEntry[];
  onClearWorkspaceMcpServers: () => void;
  onWorkspaceMcpServerButtonClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          <T>Integrations</T>
        </h3>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-[10px]">
            {selectedWorkspaceMcpServerIds.length}/{workspaceMcpServerEntries.length}
          </span>
          {selectedWorkspaceMcpServerIds.length > 0 && (
            <button
              type="button"
              onClick={onClearWorkspaceMcpServers}
              className="text-muted-foreground hover:text-foreground text-[10px] font-medium transition-colors"
            >
              <T>Clear</T>
            </button>
          )}
        </div>
      </div>
      {workspaceMcpServerEntries.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-xs">
          <T>No workspace integrations available.</T>
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {workspaceMcpServerEntries.map((source) => {
            const isActive = selectedWorkspaceMcpServerIds.includes(source.id);
            return (
              <button
                key={source.id}
                type="button"
                data-executor-source-id={source.id}
                onClick={onWorkspaceMcpServerButtonClick}
                className={cn(
                  "group relative flex items-center gap-2.5 rounded-lg border p-3 text-left transition-all duration-150",
                  isActive
                    ? "border-primary/30 bg-primary/5 shadow-sm"
                    : "border-border/40 bg-card hover:border-border/70 opacity-60 hover:opacity-100",
                )}
              >
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold uppercase",
                    isActive ? "bg-primary/10 text-primary" : "bg-muted/60 text-muted-foreground",
                  )}
                >
                  {source.kind === "mcp" ? "MCP" : "API"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] leading-tight font-medium">{source.title}</p>
                  <div className="mt-0.5 flex items-center gap-1">
                    <span
                      className={cn(
                        "inline-block h-1.5 w-1.5 rounded-full",
                        source.connected ? "bg-emerald-500" : "bg-amber-500",
                      )}
                    />
                    <span className="text-muted-foreground text-[9px] font-medium tracking-wide uppercase">
                      {source.namespace}
                      {source.connected ? "" : " · connect"}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SkillSelection({
  availableSkills,
  selectedSkillKeys,
  isSkillsLoading,
  onClearSkills,
  onSkillButtonClick,
}: {
  availableSkills: AvailableSkillEntry[];
  selectedSkillKeys: string[];
  isSkillsLoading: boolean;
  onClearSkills: () => void;
  onSkillButtonClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          <T>Skills</T>
        </h3>
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-[10px]">
            {selectedSkillKeys.length}/{availableSkills.length}
          </span>
          {selectedSkillKeys.length > 0 && (
            <button
              type="button"
              onClick={onClearSkills}
              className="text-muted-foreground hover:text-foreground text-[10px] font-medium transition-colors"
            >
              <T>Clear</T>
            </button>
          )}
        </div>
      </div>
      {isSkillsLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
        </div>
      ) : availableSkills.length === 0 ? (
        <p className="text-muted-foreground py-4 text-center text-xs">
          <T>No skills available.</T>
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {availableSkills.map((skill) => {
            const isActive = selectedSkillKeys.includes(skill.key);
            return (
              <button
                key={skill.key}
                type="button"
                data-skill-key={skill.key}
                onClick={onSkillButtonClick}
                className={cn(
                  "group relative flex items-center gap-2.5 rounded-lg border p-3 text-left transition-all duration-150",
                  isActive
                    ? "border-primary/30 bg-primary/5 shadow-sm"
                    : "border-border/40 bg-card hover:border-border/70 opacity-60 hover:opacity-100",
                )}
              >
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                    isActive ? "bg-primary/10 text-primary" : "bg-muted/60 text-muted-foreground",
                  )}
                >
                  <span className="text-sm">{skill.source === "Platform" ? "*" : "+"}</span>
                </div>
                <ToolboxItemLabel
                  title={skill.title}
                  statusLabel={skill.source}
                  isActive={isActive}
                />
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ToolboxItemLabel({
  title,
  statusLabel,
  isActive,
}: {
  title: string;
  statusLabel: string;
  isActive: boolean;
}) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-[12px] leading-tight font-medium">{title}</p>
      <div className="mt-0.5 flex items-center gap-1">
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            isActive ? "bg-emerald-500" : "bg-muted-foreground/30",
          )}
        />
        <span
          className={cn(
            "text-[9px] font-medium uppercase tracking-wide",
            isActive ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/50",
          )}
        >
          {statusLabel}
        </span>
      </div>
    </div>
  );
}
