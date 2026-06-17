import { T, useGT } from "gt-react";
import { Loader2, Play, Shield } from "lucide-react";
import { useCallback, type ChangeEvent, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INTEGRATION_DISPLAY_NAMES, type IntegrationType } from "@/lib/integration-icons";
import { cn } from "@/lib/utils";
import type { RemoteIntegrationTargetEnv, RemoteIntegrationUserOption } from "./types";

type RemoteIntegrationAdminPanelProps = {
  availableTargets: RemoteIntegrationTargetEnv[];
  selectedTargetEnv: RemoteIntegrationTargetEnv | null;
  remoteUserQuery: string;
  remoteUserOptions: RemoteIntegrationUserOption[];
  selectedRemoteUser: RemoteIntegrationUserOption | null;
  isSearching: boolean;
  isRunDisabled: boolean;
  isRunning: boolean;
  onTargetEnvChange: (value: string) => void;
  onRemoteUserQueryChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectRemoteUser: (user: RemoteIntegrationUserOption) => void;
  onRun: () => void | Promise<void>;
};

export function RemoteIntegrationAdminPanel({
  availableTargets,
  selectedTargetEnv,
  remoteUserQuery,
  remoteUserOptions,
  selectedRemoteUser,
  isSearching,
  isRunDisabled,
  isRunning,
  onTargetEnvChange,
  onRemoteUserQueryChange,
  onSelectRemoteUser,
  onRun,
}: RemoteIntegrationAdminPanelProps) {
  const t = useGT();

  const handleRemoteUserButtonClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const remoteUserId = event.currentTarget.dataset.remoteUserId;
      if (!remoteUserId) {
        return;
      }

      const remoteUser = remoteUserOptions.find((entry) => entry.id === remoteUserId);
      if (!remoteUser) {
        return;
      }

      onSelectRemoteUser(remoteUser);
    },
    [onSelectRemoteUser, remoteUserOptions],
  );
  const handleRunClick = useCallback(() => {
    void onRun();
  }, [onRun]);

  return (
    <div className="space-y-4">
      <div className="border-border/40 rounded-xl border p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
            <Shield className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">
              <T>Run with remote integrations</T>
            </p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              <T>
                This admin-only test path keeps the coworker local but borrows built-in OAuth
                integrations from a remote user in staging or prod for a single manual run.
              </T>
            </p>
          </div>
        </div>
      </div>

      {availableTargets.length === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed px-4 py-6 text-xs">
          <T>No remote integration targets are configured for this environment.</T>
        </div>
      ) : null}

      {availableTargets.length > 0 ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              <T>Source environment</T>
            </label>
            <Select value={selectedTargetEnv ?? undefined} onValueChange={onTargetEnvChange}>
              <SelectTrigger className="h-9 w-full bg-transparent text-sm">
                <SelectValue placeholder={t("Select a remote environment")} />
              </SelectTrigger>
              <SelectContent>
                {availableTargets.map((target) => (
                  <SelectItem key={target} value={target}>
                    {target === "prod" ? "Production" : "Staging"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedTargetEnv === "prod" ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
              <T>
                Production is selected. This run can mutate real client data through the remote
                user&apos;s integrations.
              </T>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              <T>Remote user email</T>
            </label>
            <Input
              value={remoteUserQuery}
              onChange={onRemoteUserQueryChange}
              placeholder={t("Search by email")}
              className="bg-transparent text-sm"
            />
          </div>

          <RemoteUserOptions
            selectedRemoteUser={selectedRemoteUser}
            remoteUserOptions={remoteUserOptions}
            isSearching={isSearching}
            onRemoteUserButtonClick={handleRemoteUserButtonClick}
          />

          {selectedRemoteUser ? <SelectedRemoteUser user={selectedRemoteUser} /> : null}

          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 px-4 text-xs font-medium"
              onClick={handleRunClick}
              disabled={isRunDisabled || !selectedTargetEnv || !selectedRemoteUser}
            >
              {isRunning ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              <T>Run with remote integrations</T>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RemoteUserOptions({
  selectedRemoteUser,
  remoteUserOptions,
  isSearching,
  onRemoteUserButtonClick,
}: {
  selectedRemoteUser: RemoteIntegrationUserOption | null;
  remoteUserOptions: RemoteIntegrationUserOption[];
  isSearching: boolean;
  onRemoteUserButtonClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          <T>Matching users</T>
        </span>
        {isSearching ? (
          <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
        ) : null}
      </div>

      {remoteUserOptions.length === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed px-4 py-5 text-xs">
          {isSearching
            ? "Searching remote users..."
            : "No remote users found with enabled built-in integrations."}
        </div>
      ) : (
        <div className="space-y-2">
          {remoteUserOptions.map((remoteUser) => {
            const isSelected = selectedRemoteUser?.id === remoteUser.id;
            return (
              <button
                key={remoteUser.id}
                type="button"
                data-remote-user-id={remoteUser.id}
                onClick={onRemoteUserButtonClick}
                className={cn(
                  "w-full rounded-xl border px-4 py-3 text-left transition-colors",
                  isSelected
                    ? "border-primary/40 bg-primary/5"
                    : "border-border/40 hover:bg-muted/30",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {remoteUser.name?.trim() || remoteUser.email}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">{remoteUser.email}</p>
                  </div>
                  {isSelected ? (
                    <span className="text-primary text-[10px] font-semibold tracking-[0.14em] uppercase">
                      <T>Selected</T>
                    </span>
                  ) : null}
                </div>
                <IntegrationBadges types={remoteUser.enabledIntegrationTypes} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SelectedRemoteUser({ user }: { user: RemoteIntegrationUserOption }) {
  return (
    <div className="border-border/40 bg-muted/20 rounded-xl border px-4 py-3">
      <div className="space-y-1">
        <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          <T>Selected remote user</T>
        </p>
        <p className="text-sm font-medium">{user.name?.trim() || user.email}</p>
        <p className="text-muted-foreground text-xs">{user.email}</p>
      </div>
      <IntegrationBadges types={user.enabledIntegrationTypes} selected />
    </div>
  );
}

function IntegrationBadges({
  types,
  selected = false,
}: {
  types: IntegrationType[];
  selected?: boolean;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {types.map((type) => (
        <span
          key={`${selected ? "selected" : "option"}-${type}`}
          className={
            selected
              ? "bg-background text-muted-foreground rounded-full border px-2 py-0.5 text-[10px] font-medium"
              : "bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium"
          }
        >
          {INTEGRATION_DISPLAY_NAMES[type] ?? type}
        </span>
      ))}
    </div>
  );
}
