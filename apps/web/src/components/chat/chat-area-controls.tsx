import { T } from "gt-react";
import { Check, CircleCheck, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import { buildSelectedSkillInstructionBlock } from "@bap/prompts/browser";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  ChatDebugPopover,
  type ArmedDebugPreset,
  type ChatDebugSnapshot,
} from "./chat-debug-popover";
import { ModelSelector } from "./model-selector";

type ModelSelectorProps = React.ComponentProps<typeof ModelSelector>;

type PlatformSkill = {
  slug: string;
  title: string;
};

type AccessibleSkill = {
  enabled: boolean;
  name: string;
  displayName: string;
  visibility: string;
  isOwnedByCurrentUser: boolean;
  owner: {
    name?: string | null;
    email?: string | null;
  };
};

export const CUSTOM_SKILL_PREFIX = "custom:";
export const buildSkillInstructionBlock = buildSelectedSkillInstructionBlock;

export function useChatAreaControls({
  accessibleSkills,
  armedDebugPreset,
  autoApproveEnabled,
  chatDebugSnapshot,
  clearSelectedSkillSlugs,
  handleArmDebugPreset,
  handleAutoApproveChange,
  handleClearDebugPreset,
  handleResumePausedRunDeadline,
  isAccessibleSkillsLoading,
  isPlatformSkillsLoading,
  isAdmin,
  isAdminLoading,
  isCoworkerConversation,
  isResumingPausedRunDeadline,
  isStreaming,
  compactControls = false,
  normalizedSelectedModel,
  platformSkills,
  providerAvailability,
  selectedAuthSource,
  selectedSkillKeys,
  setHeaderActions,
  setSelection,
  skillSelectionScopeKey,
  toggleSelectedSkillSlug,
}: {
  accessibleSkills?: AccessibleSkill[];
  armedDebugPreset: ArmedDebugPreset | null;
  autoApproveEnabled: boolean;
  chatDebugSnapshot: ChatDebugSnapshot;
  clearSelectedSkillSlugs: (scopeKey: string) => void;
  handleArmDebugPreset: (preset: ArmedDebugPreset) => void;
  handleAutoApproveChange: (checked: boolean) => void;
  handleClearDebugPreset: () => void;
  handleResumePausedRunDeadline: () => void;
  isAccessibleSkillsLoading: boolean;
  isPlatformSkillsLoading: boolean;
  isAdmin: boolean;
  isAdminLoading: boolean;
  isCoworkerConversation: boolean;
  isResumingPausedRunDeadline: boolean;
  isStreaming: boolean;
  compactControls?: boolean;
  normalizedSelectedModel: string;
  platformSkills?: PlatformSkill[];
  providerAvailability: ModelSelectorProps["providerAvailability"];
  selectedAuthSource: ModelSelectorProps["selectedAuthSource"];
  selectedSkillKeys: string[];
  setHeaderActions: (node: React.ReactNode | null) => void;
  setSelection: ModelSelectorProps["onSelectionChange"];
  skillSelectionScopeKey: string;
  toggleSelectedSkillSlug: (scopeKey: string, skillSlug: string) => void;
}) {
  const [skillsMenuOpen, setSkillsMenuOpen] = useState(false);
  const [skillSearchQuery, setSkillSearchQuery] = useState("");

  const selectableSkills = useMemo(
    () => [
      ...(platformSkills ?? []).map((skill) => ({
        key: skill.slug,
        title: skill.title,
        subtitle: "Platform",
        searchable: `${skill.title} ${skill.slug}`.toLowerCase(),
      })),
      ...((accessibleSkills ?? [])
        .filter((skill) => skill.enabled)
        .map((skill) => ({
          key: `${CUSTOM_SKILL_PREFIX}${skill.name}`,
          title: skill.displayName,
          subtitle: skill.isOwnedByCurrentUser
            ? skill.visibility === "public"
              ? "Custom · Public"
              : "Custom · Private"
            : `Shared · ${skill.owner.name ?? skill.owner.email ?? "Workspace"}`,
          searchable: `${skill.displayName} ${skill.name} ${skill.owner.name ?? ""} ${
            skill.owner.email ?? ""
          } ${skill.visibility}`.toLowerCase(),
        })) ?? []),
    ],
    [accessibleSkills, platformSkills],
  );

  const selectedSkillLabel = useMemo(() => {
    if (selectedSkillKeys.length === 0) {
      return "Skills";
    }
    if (selectedSkillKeys.length === 1) {
      const only = selectableSkills.find((skill) => skill.key === selectedSkillKeys[0]);
      const fallback = selectedSkillKeys[0] ?? "1 skill";
      return only?.title ?? fallback.replace(CUSTOM_SKILL_PREFIX, "");
    }
    return `${selectedSkillKeys.length} skills`;
  }, [selectableSkills, selectedSkillKeys]);

  const filteredSelectableSkills = useMemo(() => {
    const query = skillSearchQuery.trim().toLowerCase();
    if (!query) {
      return selectableSkills;
    }
    return selectableSkills.filter((skill) => skill.searchable.includes(query));
  }, [selectableSkills, skillSearchQuery]);

  const handleSkillDropdownSelect = useCallback(
    (event: Event) => {
      event.preventDefault();
      const target = event.currentTarget as HTMLElement | null;
      const key = target?.dataset.skillSlug;
      if (!key) {
        return;
      }
      toggleSelectedSkillSlug(skillSelectionScopeKey, key);
    },
    [skillSelectionScopeKey, toggleSelectedSkillSlug],
  );

  const handleSkillSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSkillSearchQuery(event.target.value);
  }, []);

  const handleCloseSkillsMenu = useCallback(() => {
    setSkillsMenuOpen(false);
  }, []);

  const handleClearSelectedSkills = useCallback(() => {
    clearSelectedSkillSlugs(skillSelectionScopeKey);
  }, [clearSelectedSkillSlugs, skillSelectionScopeKey]);

  const handleOpenSkillsChange = useCallback((open: boolean) => {
    setSkillsMenuOpen(open);
    if (!open) {
      setSkillSearchQuery("");
    }
  }, []);

  const handleCompactSkillToggle = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const key = event.currentTarget.dataset.skillSlug;
      if (!key) {
        return;
      }
      toggleSelectedSkillSlug(skillSelectionScopeKey, key);
    },
    [skillSelectionScopeKey, toggleSelectedSkillSlug],
  );

  const compactSkillsMenuSectionNode = useMemo(
    () => (
      <div className="space-y-1">
        <div className="text-muted-foreground px-1 text-[11px] font-medium tracking-wide uppercase">
          <T>Skills</T>
        </div>
        <div className="max-h-56 space-y-1 overflow-y-auto">
          {isPlatformOrAccessibleLoading(isAccessibleSkillsLoading, isPlatformSkillsLoading) ? (
            <div className="text-muted-foreground px-3 py-2 text-sm">
              <T>Loading...</T>
            </div>
          ) : selectableSkills.length === 0 ? (
            <div className="text-muted-foreground px-3 py-2 text-sm">
              <T>No skills found</T>
            </div>
          ) : (
            selectableSkills.map((skill) => {
              const isSelected = selectedSkillKeys.includes(skill.key);
              return (
                <button
                  key={skill.key}
                  type="button"
                  data-skill-slug={skill.key}
                  onClick={handleCompactSkillToggle}
                  className="hover:bg-muted flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors"
                >
                  <Check
                    className={isSelected ? "mt-0.5 h-4 w-4 opacity-100" : "mt-0.5 h-4 w-4 opacity-0"}
                  />
                  <div className="min-w-0">
                    <div className="truncate">{skill.title}</div>
                    <div className="text-muted-foreground truncate text-[10px]">
                      {skill.subtitle}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    ),
    [
      isAccessibleSkillsLoading,
      isPlatformSkillsLoading,
      selectableSkills,
      selectedSkillKeys,
      handleCompactSkillToggle,
    ],
  );

  const skillsMenuNode = useMemo(
    () => (
      <DropdownMenu open={skillsMenuOpen} onOpenChange={handleOpenSkillsChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={selectedSkillLabel}
            className="text-muted-foreground hover:bg-muted hover:text-foreground relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
          >
            <Sparkles className="h-4 w-4" />
            {selectedSkillKeys.length > 0 ? (
              <span className="bg-foreground text-background absolute -top-1 -right-1 inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-medium">
                {selectedSkillKeys.length}
              </span>
            ) : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={12}
          className="border-border/80 bg-background/95 flex h-[360px] w-[320px] flex-col rounded-xl p-0 shadow-xl backdrop-blur-sm"
        >
          <DropdownMenuLabel className="px-3 py-2.5">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
              <Input
                value={skillSearchQuery}
                onChange={handleSkillSearchChange}
                placeholder="Search skills..."
                className="h-9 pl-8"
              />
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {isPlatformOrAccessibleLoading(isAccessibleSkillsLoading, isPlatformSkillsLoading) ? (
              <DropdownMenuItem disabled>
                <T>Loading...</T>
              </DropdownMenuItem>
            ) : filteredSelectableSkills.length === 0 ? (
              <DropdownMenuItem disabled>
                <T>No skills found</T>
              </DropdownMenuItem>
            ) : (
              filteredSelectableSkills.map((skill) => {
                const isSelected = selectedSkillKeys.includes(skill.key);
                return (
                  <DropdownMenuItem
                    key={skill.key}
                    data-skill-slug={skill.key}
                    onSelect={handleSkillDropdownSelect}
                  >
                    <Check className={isSelected ? "h-4 w-4 opacity-100" : "h-4 w-4 opacity-0"} />
                    <div className="min-w-0">
                      <div className="truncate">{skill.title}</div>
                      <div className="text-muted-foreground truncate text-[10px]">
                        {skill.subtitle}
                      </div>
                    </div>
                  </DropdownMenuItem>
                );
              })
            )}
          </div>
          <DropdownMenuSeparator />
          <div className="grid grid-cols-2 items-center gap-0 p-1">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClearSelectedSkills}
              disabled={selectedSkillKeys.length === 0}
              className="h-10 rounded-md"
            >
              <T>Clear</T>
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={handleCloseSkillsMenu}
              className="h-10 rounded-md"
            >
              <T>Close</T>
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    [
      filteredSelectableSkills,
      handleClearSelectedSkills,
      handleCloseSkillsMenu,
      handleOpenSkillsChange,
      handleSkillDropdownSelect,
      handleSkillSearchChange,
      isAccessibleSkillsLoading,
      isPlatformSkillsLoading,
      selectedSkillKeys,
      selectedSkillLabel,
      skillSearchQuery,
      skillsMenuOpen,
    ],
  );

  const modelSelectorNode = useMemo(
    () => (
      <ModelSelector
        selectedModel={normalizedSelectedModel}
        selectedAuthSource={selectedAuthSource}
        providerAvailability={providerAvailability}
        onSelectionChange={setSelection}
        disabled={isStreaming}
      />
    ),
    [isStreaming, normalizedSelectedModel, providerAvailability, selectedAuthSource, setSelection],
  );

  const autoApprovalNode = useMemo(
    () =>
      isCoworkerConversation ? null : (
        <div className="flex items-center gap-1.5">
          <Switch
            id="auto-approve"
            checked={autoApproveEnabled}
            onCheckedChange={handleAutoApproveChange}
          />
          <label
            htmlFor="auto-approve"
            className="text-muted-foreground flex cursor-pointer items-center gap-1 text-xs select-none"
            title="Auto-approve"
          >
            {!compactControls ? <CircleCheck className="h-3.5 w-3.5" /> : null}
            <span className={compactControls ? "text-[11px]" : "hidden sm:inline"}>
              <T>Auto-approve</T>
            </span>
          </label>
        </div>
      ),
    [autoApproveEnabled, compactControls, handleAutoApproveChange, isCoworkerConversation],
  );

  const debugControlNode = useMemo(() => {
    if (!isAdmin || isAdminLoading) {
      return null;
    }

    return (
      <ChatDebugPopover
        armedPreset={armedDebugPreset}
        snapshot={chatDebugSnapshot}
        disabled={isStreaming}
        onArmPreset={handleArmDebugPreset}
        onClearPreset={handleClearDebugPreset}
        onResumeRunDeadline={handleResumePausedRunDeadline}
        isResumingRunDeadline={isResumingPausedRunDeadline}
      />
    );
  }, [
    armedDebugPreset,
    chatDebugSnapshot,
    handleArmDebugPreset,
    handleClearDebugPreset,
    handleResumePausedRunDeadline,
    isAdmin,
    isAdminLoading,
    isResumingPausedRunDeadline,
    isStreaming,
  ]);

  useEffect(() => {
    setHeaderActions(debugControlNode);
    return () => {
      setHeaderActions(null);
    };
  }, [debugControlNode, setHeaderActions]);

  return {
    autoApprovalNode,
    compactSkillsMenuSectionNode,
    modelSelectorNode,
    skillsMenuNode: compactControls ? null : skillsMenuNode,
    selectedSkillCount: selectedSkillKeys.length,
  };
}

function isPlatformOrAccessibleLoading(
  isAccessibleSkillsLoading: boolean,
  isPlatformSkillsLoading: boolean,
) {
  return isPlatformSkillsLoading || isAccessibleSkillsLoading;
}
