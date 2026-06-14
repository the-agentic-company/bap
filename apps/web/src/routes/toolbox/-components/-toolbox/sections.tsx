// oxlint-disable jsx-a11y/control-has-associated-label

import { T } from "gt-react";
import { FileInput, FileOutput, Loader2, Plus, Puzzle, Search, Wand2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ChangeEvent, RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AnimatedTabs, AnimatedTab } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AppLink } from "../../-lib/app-link";
import {
  CommunityToolCard,
  CustomToolCard,
  IntegrationToolCard,
  WorkspaceMcpServerToolCard,
} from "./cards";
import {
  adminPreviewOnlyIntegrations,
  type CommunitySkill,
  type FilterTab,
  type IntegrationType,
  type OAuthIntegrationType,
} from "./data";

type IntegrationConfigValue = { name: string; description: string; icon: string };

type ConnectedIntegration = {
  id: string;
  type: string;
  enabled: boolean;
  displayName: string | null;
  setupRequired?: boolean;
};

type CustomSkill = React.ComponentProps<typeof CustomToolCard>["skill"];
type WorkspaceMcpSource = React.ComponentProps<typeof WorkspaceMcpServerToolCard>["source"];

type SkillActionHandlers = {
  onDelete: (id: string, displayName: string) => Promise<void>;
  onShare: (id: string, displayName: string) => Promise<void>;
  onUnshare: (id: string, displayName: string) => Promise<void>;
  onSaveShared: (id: string, displayName: string) => Promise<void>;
};

export function ToolboxToolbar({
  activeTab,
  tabs,
  onTabChange,
  importPending,
  isCreating,
  isWorkspaceAdmin,
  supportsFolderImport,
  search,
  t,
  onNewMcpSource,
  onImportZipClick,
  onImportFolderClick,
  onCreateSkill,
  onSearchChange,
  zipImportInputRef,
  folderImportInputRef,
  onImportZipChange,
  onImportFolderChange,
}: {
  activeTab: FilterTab;
  tabs: { id: FilterTab; label: string; count: number }[];
  onTabChange: (key: string) => void;
  importPending: boolean;
  isCreating: boolean;
  isWorkspaceAdmin: boolean;
  supportsFolderImport: boolean;
  search: string;
  t: (s: string) => string;
  onNewMcpSource: () => void;
  onImportZipClick: () => void;
  onImportFolderClick: () => void;
  onCreateSkill: () => void;
  onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  zipImportInputRef: RefObject<HTMLInputElement | null>;
  folderImportInputRef: RefObject<HTMLInputElement | null>;
  onImportZipChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onImportFolderChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="mb-8 space-y-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 overflow-x-auto">
          <AnimatedTabs
            activeKey={activeTab}
            onTabChange={onTabChange}
            className="w-full min-w-max grid-cols-3 sm:flex sm:w-fit sm:min-w-0"
          >
            {tabs.map((tab) => (
              <AnimatedTab key={tab.id} value={tab.id} className="text-[11px] sm:text-sm">
                {tab.label}
                <span
                  className={cn(
                    "ml-1 rounded-full px-1.5 py-0.5 text-[10px] sm:ml-1.5 sm:text-xs",
                    activeTab === tab.id
                      ? "bg-foreground/10 text-foreground/70"
                      : "bg-muted-foreground/15 text-muted-foreground",
                  )}
                >
                  {tab.count}
                </span>
              </AnimatedTab>
            ))}
          </AnimatedTabs>
        </div>
        <div className="shrink-0 xl:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={importPending || isCreating}>
                {importPending || isCreating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="mr-2 h-4 w-4" />
                )}
                <T>Actions</T>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isWorkspaceAdmin ? (
                <>
                  <DropdownMenuItem onClick={onNewMcpSource}>
                    <Puzzle className="h-4 w-4" />
                    <T>Add MCP</T>
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuItem onClick={onImportZipClick} disabled={importPending}>
                <FileInput className="h-4 w-4" />
                <T>Import .zip</T>
              </DropdownMenuItem>
              {supportsFolderImport ? (
                <DropdownMenuItem onClick={onImportFolderClick} disabled={importPending}>
                  <FileOutput className="h-4 w-4" />
                  <T>Import folder</T>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={onCreateSkill} disabled={isCreating}>
                <Plus className="h-4 w-4" />
                <T>Create Skill</T>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="border-border flex w-full min-w-0 items-center gap-3 rounded-xl border px-4 py-2.5 xl:w-80 xl:flex-initial">
          <Search className="text-muted-foreground/60 size-4 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={onSearchChange}
            placeholder={t("Search tools…")}
            className="placeholder:text-muted-foreground/40 w-full bg-transparent text-sm outline-none"
          />
        </div>
        <div className="hidden items-center gap-2 xl:flex">
          {isWorkspaceAdmin && (
            <>
              <Button variant="outline" asChild>
                <AppLink href="/toolbox/sources/new?kind=mcp">
                  <Puzzle className="mr-2 h-4 w-4" />
                  <T>Add MCP</T>
                </AppLink>
              </Button>
            </>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={importPending}>
                {importPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileInput className="mr-2 h-4 w-4" />
                )}
                <T>Import Skill</T>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onImportZipClick} disabled={importPending}>
                <FileInput className="h-4 w-4" />
                <T>Import .zip</T>
              </DropdownMenuItem>
              {supportsFolderImport ? (
                <DropdownMenuItem onClick={onImportFolderClick} disabled={importPending}>
                  <FileOutput className="h-4 w-4" />
                  <T>Import folder</T>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={onCreateSkill} disabled={isCreating}>
            {isCreating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            <T>Create Skill</T>
          </Button>
        </div>
        <input
          ref={zipImportInputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          aria-label={t("Import skill zip")}
          onChange={onImportZipChange}
        />
        <input
          ref={folderImportInputRef}
          type="file"
          multiple
          className="hidden"
          aria-label={t("Import skill folder")}
          onChange={onImportFolderChange}
        />
      </div>
    </div>
  );
}

export function ToolboxResults({
  filteredOwnedSkills,
  filteredSharedSkills,
  filteredIntegrations,
  filteredWorkspaceMcpServers,
  filteredCommunitySkills,
  skillHandlers,
  connectedIntegrations,
  isMobile,
  integrationConnectErrors,
  communitySkillToggles,
}: {
  filteredOwnedSkills: CustomSkill[];
  filteredSharedSkills: CustomSkill[];
  filteredIntegrations: [IntegrationType, IntegrationConfigValue][];
  filteredWorkspaceMcpServers: WorkspaceMcpSource[];
  filteredCommunitySkills: CommunitySkill[];
  skillHandlers: SkillActionHandlers;
  connectedIntegrations: Map<string, ConnectedIntegration>;
  isMobile: boolean;
  integrationConnectErrors: Partial<Record<OAuthIntegrationType, string>>;
  communitySkillToggles: Record<string, boolean>;
}) {
  return (
    <div className="space-y-10">
      {/* Personal skills section */}
      {filteredOwnedSkills.length > 0 && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">
                <T>My Skills</T>
              </h2>
              <p className="text-muted-foreground mt-0.5 text-xs">
                <T>Private skills you own in this workspace</T>
              </p>
            </div>
            <p className="text-muted-foreground text-xs">
              {filteredOwnedSkills.length} <T>tool</T>
              {filteredOwnedSkills.length !== 1 ? "s" : ""}
            </p>
          </div>
          <motion.div layout className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {filteredOwnedSkills.map((skill) => (
                <CustomToolCard
                  key={skill.id}
                  skill={skill}
                  onDelete={skillHandlers.onDelete}
                  onShare={skillHandlers.onShare}
                  onUnshare={skillHandlers.onUnshare}
                  onSaveShared={skillHandlers.onSaveShared}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        </section>
      )}

      {/* Shared skills section */}
      {filteredSharedSkills.length > 0 && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">
                <T>Workspace Skills</T>
              </h2>
              <p className="text-muted-foreground mt-0.5 text-xs">
                <T>Public skills shared by other people in your workspace</T>
              </p>
            </div>
            <p className="text-muted-foreground text-xs">
              {filteredSharedSkills.length} <T>tool</T>
              {filteredSharedSkills.length !== 1 ? "s" : ""}
            </p>
          </div>
          <motion.div layout className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {filteredSharedSkills.map((skill) => (
                <CustomToolCard
                  key={skill.id}
                  skill={skill}
                  onDelete={skillHandlers.onDelete}
                  onShare={skillHandlers.onShare}
                  onUnshare={skillHandlers.onUnshare}
                  onSaveShared={skillHandlers.onSaveShared}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        </section>
      )}

      {/* Integrations section */}
      {filteredIntegrations.length > 0 && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">
                <T>Integrations</T>
              </h2>
              <p className="text-muted-foreground mt-0.5 text-xs">
                <T>Connect external services to your coworker</T>
              </p>
            </div>
            <p className="text-muted-foreground text-xs">
              {filteredIntegrations.length} <T>tool</T>
              {filteredIntegrations.length !== 1 ? "s" : ""}
            </p>
          </div>
          <motion.div layout className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {filteredIntegrations.map(([type, config]) => {
                const integration = connectedIntegrations.get(type) ?? null;
                return (
                  <IntegrationToolCard
                    key={type}
                    config={config}
                    href={
                      isMobile ? `/integrations/${type}` : `/toolbox?preview=integration:${type}`
                    }
                    integration={integration}
                    connectError={
                      !integration
                        ? integrationConnectErrors[type as OAuthIntegrationType]
                        : undefined
                    }
                    isPreviewOnly={adminPreviewOnlyIntegrations.has(type)}
                  />
                );
              })}
            </AnimatePresence>
          </motion.div>
        </section>
      )}

      {/* Workspace MCP Servers section */}
      {filteredWorkspaceMcpServers.length > 0 && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">
                <T>MCP Servers</T>
              </h2>
              <p className="text-muted-foreground mt-0.5 text-xs">
                <T>MCP servers configured for your workspace</T>
              </p>
            </div>
            <p className="text-muted-foreground text-xs">
              {filteredWorkspaceMcpServers.length} <T>source</T>
              {filteredWorkspaceMcpServers.length !== 1 ? "s" : ""}
            </p>
          </div>
          <motion.div layout className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {filteredWorkspaceMcpServers.map((source) => (
                <WorkspaceMcpServerToolCard key={source.id} source={source} />
              ))}
            </AnimatePresence>
          </motion.div>
        </section>
      )}

      {/* Community Skills section */}
      {filteredCommunitySkills.length > 0 && (
        <section>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">
                <T>Community Skills</T>
              </h2>
              <p className="text-muted-foreground mt-0.5 text-xs">
                <T>Pre-built skills ready to activate</T>
              </p>
            </div>
            <p className="text-muted-foreground text-xs">
              {filteredCommunitySkills.length} <T>tool</T>
              {filteredCommunitySkills.length !== 1 ? "s" : ""}
            </p>
          </div>
          <motion.div layout className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {filteredCommunitySkills.map((skill) => (
                <CommunityToolCard
                  key={skill.id}
                  skill={skill}
                  enabled={communitySkillToggles[skill.id] ?? skill.enabled}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        </section>
      )}
    </div>
  );
}
