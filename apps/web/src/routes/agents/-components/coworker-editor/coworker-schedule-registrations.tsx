import { T } from "gt-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { IntegrationType } from "@/lib/integration-icons";
import {
  useChangeCoworkerAutomationRegistration,
  useCoworkerAutomationRegistrations,
  useMyCoworkerAutomationAccountPreferences,
  useRegisterForCoworkerAutomation,
  useSetMyCoworkerAutomationAccountPreference,
} from "@/orpc/hooks/coworkers";
import { useAccountLabels } from "@/orpc/hooks/integrations";
import { AppImage as Image } from "../../-lib/app-image";

type CoworkerScheduleRegistrationsProps = {
  coworkerId: string;
  allowedIntegrations: IntegrationType[];
};

export function CoworkerScheduleRegistrations({
  coworkerId,
  allowedIntegrations,
}: CoworkerScheduleRegistrationsProps) {
  const registrations = useCoworkerAutomationRegistrations(coworkerId);
  const register = useRegisterForCoworkerAutomation();
  const changeRegistration = useChangeCoworkerAutomationRegistration();
  const registrationData = registrations.data;
  const currentRegistration = registrationData?.currentUserRegistration;
  const isCurrentUserRegistered = Boolean(
    currentRegistration &&
    currentRegistration.status !== "removed" &&
    currentRegistration.status !== "membership_revoked",
  );
  const isCurrentUserActive = currentRegistration?.status === "active";
  const accountPreferences = useMyCoworkerAutomationAccountPreferences(
    coworkerId,
    isCurrentUserRegistered,
  );
  const setAccountPreference = useSetMyCoworkerAutomationAccountPreference();
  const accountLabels = useAccountLabels();
  const visibleRegistrations =
    registrationData?.registrations.filter(
      (registration) =>
        registration.status !== "removed" && registration.status !== "membership_revoked",
    ) ?? [];
  const ambiguousAccounts = allowedIntegrations
    .map((integrationType) => ({
      integrationType,
      labels:
        accountLabels.data?.filter((label) =>
          label.connectedAccounts.some(
            (account) => account.integrationType === integrationType && account.enabled,
          ),
        ) ?? [],
    }))
    .filter((entry) => entry.labels.length > 1);

  const handleMyRegistrationChange = useCallback(
    (checked: boolean) => {
      if (checked) {
        register.mutate({ coworkerId });
        return;
      }
      if (registrationData?.currentUserId) {
        changeRegistration.mutate({
          coworkerId,
          userId: registrationData.currentUserId,
          action: "remove",
        });
      }
    },
    [changeRegistration, coworkerId, register, registrationData?.currentUserId],
  );
  const handleRegistrationAction = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const userId = event.currentTarget.dataset.userId;
      const action = event.currentTarget.dataset.action as
        | "pause"
        | "resume"
        | "remove"
        | undefined;
      if (userId && action) {
        changeRegistration.mutate({ coworkerId, userId, action });
      }
    },
    [changeRegistration, coworkerId],
  );
  const handleAccountPreferenceChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      setAccountPreference.mutate({
        coworkerId,
        integrationType: event.currentTarget.dataset.integrationType as IntegrationType,
        accountLabel: event.currentTarget.value || null,
      });
    },
    [coworkerId, setAccountPreference],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium">
            <T>Scheduled runs</T>
          </p>
          {registrations.isError ? (
            <p className="text-muted-foreground mt-0.5 text-xs">
              <T>Could not load registrations.</T>
            </p>
          ) : null}
        </div>
        {!registrations.isLoading && registrationData ? (
          <label className="flex shrink-0 items-center gap-2 text-xs font-medium">
            <T>Run this schedule for me</T>
            <Switch
              checked={isCurrentUserActive}
              onCheckedChange={handleMyRegistrationChange}
              disabled={register.isPending || changeRegistration.isPending}
              aria-label="Run this schedule for me"
            />
          </label>
        ) : null}
      </div>

      {registrationData ? (
        visibleRegistrations.length > 0 ? (
          <div className="divide-border/50 divide-y">
            {visibleRegistrations.map((registration) => (
              <div key={registration.id} className="flex min-h-9 items-center gap-2 py-1.5">
                {registration.image ? (
                  <Image
                    src={registration.image}
                    alt=""
                    width={24}
                    height={24}
                    className="size-6 rounded-full object-cover"
                  />
                ) : (
                  <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold">
                    {registration.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">
                    {registration.name}
                    {registration.isYou ? " · You" : ""}
                  </p>
                  {registration.status !== "active" ? (
                    <p className="text-muted-foreground text-[11px] capitalize">
                      {registration.status.replaceAll("_", " ")}
                    </p>
                  ) : null}
                </div>
                {!registration.isYou && registrationData.canAdminister ? (
                  <div className="flex items-center gap-1">
                    {registration.status === "active" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        data-user-id={registration.userId}
                        data-action="pause"
                        onClick={handleRegistrationAction}
                        disabled={changeRegistration.isPending}
                      >
                        <T>Pause</T>
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      data-user-id={registration.userId}
                      data-action="remove"
                      onClick={handleRegistrationAction}
                      disabled={changeRegistration.isPending}
                    >
                      <T>Remove</T>
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            <T>No one is registered yet.</T>
          </p>
        )
      ) : null}

      {isCurrentUserRegistered && ambiguousAccounts.length > 0 ? (
        <div className="border-border/50 space-y-2 border-t pt-3">
          <div>
            <p className="text-xs font-medium">
              <T>My Connected Accounts</T>
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              <T>These choices are private to you and used only for your scheduled runs.</T>
            </p>
          </div>
          {ambiguousAccounts.map(({ integrationType, labels }) => (
            <label key={integrationType} className="block text-xs">
              <span className="mb-1 block capitalize">{integrationType.replaceAll("_", " ")}</span>
              <select
                className="border-input bg-background h-8 w-full rounded-md border px-2"
                aria-label={`Account for ${integrationType.replaceAll("_", " ")}`}
                data-integration-type={integrationType}
                value={accountPreferences.data?.[integrationType]?.accountLabel ?? ""}
                onChange={handleAccountPreferenceChange}
                disabled={setAccountPreference.isPending}
              >
                <option value="">Choose automatically</option>
                {labels.map((label) => (
                  <option key={label.id} value={label.accountLabel}>
                    {label.accountLabel}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
