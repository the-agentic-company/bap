// oxlint-disable jsx-a11y/control-has-associated-label

import { Link } from "@tanstack/react-router";
import { T } from "gt-react";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  Pencil,
  Trash2,
  XCircle,
} from "lucide-react";
import type { RefObject } from "react";
import { IntegrationBadges } from "@/components/chat/integration-badges";
import { Button } from "@/components/ui/button";
import { IconPicker } from "@/components/ui/icon-picker";
import { Switch } from "@/components/ui/switch";
import type { DisplayIntegrationType } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";

type Notification = { type: "success" | "error"; message: string } | null;

export function SkillEditorHeader({
  canEdit,
  owner,
  isSaving,
  isSavingShared,
  notification,
  onDeleteSkill,
  onSaveSharedSkill,
}: {
  canEdit: boolean;
  owner: { name: string | null; email: string | null };
  isSaving: boolean;
  isSavingShared: boolean;
  notification: Notification;
  onDeleteSkill: () => void;
  onSaveSharedSkill: () => void;
}) {
  return (
    <div className="mb-6 flex shrink-0 items-center justify-between">
      <Button variant="ghost" size="icon" asChild>
        <Link to="/toolbox">
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </Button>
      <div className="flex items-center gap-2">
        {!canEdit ? (
          <span className="text-muted-foreground text-xs">
            <T>Shared by</T> {owner.name ?? owner.email ?? "workspace"}
          </span>
        ) : null}
        <span
          className={cn(
            "flex items-center gap-1.5 text-xs transition-opacity",
            isSaving
              ? "opacity-100 text-muted-foreground"
              : notification?.type === "success"
                ? "opacity-100 text-green-600 dark:text-green-400"
                : notification?.type === "error"
                  ? "opacity-100 text-red-600 dark:text-red-400"
                  : "opacity-0 text-muted-foreground",
          )}
        >
          {isSaving ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <T>Saving...</T>
            </>
          ) : notification?.type === "success" ? (
            <>
              <CheckCircle2 className="h-3 w-3" />
              <T>Saved</T>
            </>
          ) : notification?.type === "error" ? (
            <>
              <XCircle className="h-3 w-3" />
              {notification.message}
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3 w-3" />
              <T>Saved</T>
            </>
          )}
        </span>
        {canEdit ? (
          <Button variant="ghost" size="sm" onClick={onDeleteSkill}>
            <Trash2 className="h-3 w-3" />
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={onSaveSharedSkill}>
            {isSavingShared ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            <T>Save to my skills</T>
          </Button>
        )}
      </div>
    </div>
  );
}

export function SkillEditorMetadata({
  canEdit,
  isEnabled,
  isSaving,
  skillIcon,
  setSkillIcon,
  skillDisplayName,
  skillSlug,
  skillDescription,
  isEditingSlug,
  isEditingDescription,
  toolIntegrations,
  t,
  displayNameRef,
  slugRef,
  descriptionRef,
  onToggleEnabled,
  onDisplayNameInputChange,
  onSlugInputChange,
  onStopEditingSlug,
  onSlugInputKeyDown,
  onStartEditingSlug,
  onDescriptionInputChange,
  onStopEditingDescription,
  onDescriptionInputKeyDown,
  onStartEditingDescription,
}: {
  canEdit: boolean;
  isEnabled: boolean;
  isSaving: boolean;
  skillIcon: string | null;
  setSkillIcon: (icon: string | null) => void;
  skillDisplayName: string;
  skillSlug: string;
  skillDescription: string;
  isEditingSlug: boolean;
  isEditingDescription: boolean;
  toolIntegrations: DisplayIntegrationType[];
  t: (s: string) => string;
  displayNameRef: RefObject<HTMLInputElement | null>;
  slugRef: RefObject<HTMLInputElement | null>;
  descriptionRef: RefObject<HTMLTextAreaElement | null>;
  onToggleEnabled: (enabled: boolean) => void;
  onDisplayNameInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSlugInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onStopEditingSlug: () => void;
  onSlugInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onStartEditingSlug: () => void;
  onDescriptionInputChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onStopEditingDescription: () => void;
  onDescriptionInputKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onStartEditingDescription: () => void;
}) {
  return (
    <div className="mb-6 shrink-0 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 rounded-full",
              isEnabled ? "bg-green-500" : "bg-muted-foreground/30",
            )}
          />
          <span className="text-muted-foreground text-sm">
            {isEnabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground text-xs font-medium">
            {isEnabled ? "On" : "Off"}
          </span>
          <Switch
            checked={isEnabled}
            onCheckedChange={onToggleEnabled}
            disabled={!canEdit || isSaving}
            aria-label={t("Toggle skill enabled")}
          />
        </div>
      </div>

      {/* Icon and Display Name */}
      <div className="flex items-start gap-3">
        {canEdit ? (
          <IconPicker value={skillIcon} onChange={setSkillIcon}>
            <button
              type="button"
              className="bg-muted hover:bg-muted/80 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border transition-colors"
            >
              {skillIcon ? (
                <span className="text-2xl">{skillIcon}</span>
              ) : (
                <FileText className="text-muted-foreground h-6 w-6" />
              )}
            </button>
          </IconPicker>
        ) : (
          <div className="bg-muted flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border">
            {skillIcon ? (
              <span className="text-2xl">{skillIcon}</span>
            ) : (
              <FileText className="text-muted-foreground h-6 w-6" />
            )}
          </div>
        )}
        <input
          ref={displayNameRef}
          type="text"
          value={skillDisplayName}
          onChange={onDisplayNameInputChange}
          placeholder={t("Untitled Skill")}
          readOnly={!canEdit}
          className="placeholder:text-muted-foreground/50 w-full bg-transparent pt-1 text-3xl font-bold outline-none focus:outline-none"
        />
      </div>

      {/* Slug - Small monospace, editable on click */}
      <div className="flex items-center gap-1.5">
        {isEditingSlug ? (
          <input
            ref={slugRef}
            type="text"
            value={skillSlug}
            onChange={onSlugInputChange}
            onBlur={onStopEditingSlug}
            onKeyDown={onSlugInputKeyDown}
            className="text-muted-foreground h-6 bg-transparent font-mono text-xs outline-none"
            autoFocus
          />
        ) : (
          <button
            onClick={onStartEditingSlug}
            disabled={!canEdit}
            className="group text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
          >
            <span className="font-mono">{skillSlug || "skill-slug"}</span>
            {canEdit ? <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100" /> : null}
          </button>
        )}
      </div>

      {/* Description - Muted text, expands to input on click */}
      {isEditingDescription ? (
        <textarea
          ref={descriptionRef}
          value={skillDescription}
          onChange={onDescriptionInputChange}
          onBlur={onStopEditingDescription}
          onKeyDown={onDescriptionInputKeyDown}
          placeholder={t("Add a description...")}
          className="text-muted-foreground placeholder:text-muted-foreground/50 min-h-20 w-full resize-y bg-transparent text-sm outline-none"
          autoFocus
        />
      ) : (
        <button
          onClick={onStartEditingDescription}
          disabled={!canEdit}
          className="text-muted-foreground hover:text-foreground text-left text-sm whitespace-pre-wrap"
        >
          {skillDescription || (
            <span className="text-muted-foreground/50">
              <T>Add a description...</T>
            </span>
          )}
        </button>
      )}

      {toolIntegrations.length > 0 ? (
        <div className="pt-2">
          <p className="text-muted-foreground mb-2 text-[10px] font-medium tracking-widest uppercase">
            <T>Tool Integrations</T>
          </p>
          <IntegrationBadges integrations={toolIntegrations} size="md" />
        </div>
      ) : null}
    </div>
  );
}
