import type { ITimezone } from "react-timezone-select";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import TimezoneSelect from "react-timezone-select";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Switch } from "@/components/ui/switch";
import { authClient } from "@/lib/auth-client";
import {
  setupBrowserPushNotifications,
  unregisterBrowserPushSubscription,
} from "@/lib/browser-push";
import { useCurrentUser, useSetTaskDonePushEnabled, useSetUserTimezone } from "@/orpc/hooks/user";

export const Route = createFileRoute("/settings/")({
  head: () => ({ meta: [{ title: "General Settings - CmdClaw" }] }),
  component: SettingsPage,
});

type SessionData = Awaited<ReturnType<typeof authClient.getSession>>["data"];

function getPhoneNumber(user: unknown): string {
  if (user && typeof user === "object" && "phoneNumber" in user) {
    const value = (user as { phoneNumber?: string | null }).phoneNumber;
    if (typeof value !== "string" || value.length === 0) {
      return "";
    }
    return value.startsWith("+") ? value : `+${value}`;
  }
  return "";
}

function isValidIanaTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function useTimezoneSelectStyles() {
  return useMemo(
    () => ({
      control: (base: Record<string, unknown>, state: { isFocused: boolean }) => ({
        ...base,
        backgroundColor: "transparent",
        borderColor: state.isFocused ? "var(--color-ring)" : "var(--color-input)",
        borderRadius: "var(--radius-md)",
        minHeight: "36px",
        boxShadow: state.isFocused
          ? "0 0 0 3px color-mix(in oklab, var(--color-ring) 50%, transparent)"
          : "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        fontSize: "14px",
        "&:hover": {
          borderColor: state.isFocused ? "var(--color-ring)" : "var(--color-input)",
        },
      }),
      menu: (base: Record<string, unknown>) => ({
        ...base,
        backgroundColor: "var(--color-popover)",
        color: "var(--color-popover-foreground)",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--color-border)",
        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
        zIndex: 50,
        overflow: "hidden",
      }),
      menuList: (base: Record<string, unknown>) => ({
        ...base,
        padding: "4px",
      }),
      option: (
        base: Record<string, unknown>,
        state: { isFocused: boolean; isSelected: boolean },
      ) => ({
        ...base,
        backgroundColor: state.isSelected
          ? "var(--color-accent)"
          : state.isFocused
            ? "var(--color-accent)"
            : "transparent",
        color: state.isSelected
          ? "var(--color-accent-foreground)"
          : state.isFocused
            ? "var(--color-accent-foreground)"
            : "var(--color-popover-foreground)",
        borderRadius: "var(--radius-sm)",
        fontSize: "14px",
        padding: "6px 8px",
        cursor: "pointer",
        "&:active": {
          backgroundColor: "var(--color-accent)",
        },
      }),
      singleValue: (base: Record<string, unknown>) => ({
        ...base,
        color: "var(--color-foreground)",
      }),
      input: (base: Record<string, unknown>) => ({
        ...base,
        color: "var(--color-foreground)",
      }),
      placeholder: (base: Record<string, unknown>) => ({
        ...base,
        color: "var(--color-muted-foreground)",
      }),
      indicatorSeparator: () => ({
        display: "none",
      }),
      dropdownIndicator: (base: Record<string, unknown>) => ({
        ...base,
        color: "var(--color-muted-foreground)",
        padding: "0 8px",
        "&:hover": {
          color: "var(--color-foreground)",
        },
      }),
      noOptionsMessage: (base: Record<string, unknown>) => ({
        ...base,
        color: "var(--color-muted-foreground)",
        fontSize: "14px",
      }),
    }),
    [],
  );
}

function SettingsPage() {
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingPhone, setRemovingPhone] = useState(false);
  const [timezoneInput, setTimezoneInput] = useState("");
  const [isUpdatingTaskDonePush, setIsUpdatingTaskDonePush] = useState(false);
  const { data: currentUser } = useCurrentUser();
  const setUserTimezone = useSetUserTimezone();
  const setTaskDonePushEnabled = useSetTaskDonePushEnabled();
  const browserTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "", []);
  const timezoneSelectStyles = useTimezoneSelectStyles();

  useEffect(() => {
    authClient
      .getSession()
      .then((res) => {
        setSessionData(res?.data ?? null);
        if (res?.data?.user?.name) {
          const nameParts = res.data.user.name.split(" ");
          setFirstName(nameParts[0] || "");
          setLastName(nameParts.slice(1).join(" ") || "");
        }
        const phone = getPhoneNumber(res?.data?.user);
        if (phone) {
          setPhoneNumber(phone);
        }
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  useEffect(() => {
    if (currentUser?.timezone) {
      setTimezoneInput(currentUser.timezone);
      return;
    }
    if (browserTimezone) {
      setTimezoneInput(browserTimezone);
    }
  }, [currentUser?.timezone, browserTimezone]);

  const handleSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSaving(true);

      try {
        const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
        await authClient.updateUser({
          name: fullName,
          phoneNumber: phoneNumber || undefined,
        });
        toast.success("Settings saved");
      } catch (error) {
        console.error("Failed to update user:", error);
        toast.error("Failed to save settings");
      } finally {
        setSaving(false);
      }
    },
    [firstName, lastName, phoneNumber],
  );

  const handleRemovePhoneNumber = useCallback(async () => {
    setRemovingPhone(true);
    try {
      const res = await fetch("/api/settings/phone-number", {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error("Failed to remove phone number");
      }
      setPhoneNumber("");
      setSessionData((prev: SessionData | null) =>
        prev
          ? {
              ...prev,
              user: {
                ...prev.user,
                phoneNumber: null,
              },
            }
          : prev,
      );
      toast.success("Phone number removed");
    } catch (error) {
      console.error("Failed to remove phone number:", error);
      toast.error("Failed to remove phone number");
    } finally {
      setRemovingPhone(false);
    }
  }, []);

  const handleFirstNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setFirstName(event.target.value);
  }, []);

  const handleLastNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setLastName(event.target.value);
  }, []);

  const handlePhoneNumberChange = useCallback((value?: string) => {
    setPhoneNumber(value ?? "");
  }, []);

  const handleTimezoneChange = useCallback(
    (tz: ITimezone) => {
      const value = typeof tz === "string" ? tz : tz.value;
      setTimezoneInput(value);
      if (!value || !isValidIanaTimezone(value)) {
        return;
      }
      void setUserTimezone
        .mutateAsync(value)
        .then(() => toast.success("Timezone updated"))
        .catch((error) => {
          console.error("Failed to update timezone:", error);
          toast.error("Failed to update timezone");
        });
    },
    [setUserTimezone],
  );

  const handleUseBrowserTimezone = useCallback(() => {
    if (!browserTimezone) {
      return;
    }
    setTimezoneInput(browserTimezone);
    void setUserTimezone
      .mutateAsync(browserTimezone)
      .then(() => toast.success("Timezone updated"))
      .catch((error) => {
        console.error("Failed to update timezone:", error);
        toast.error("Failed to update timezone");
      });
  }, [browserTimezone, setUserTimezone]);

  const handleTaskDonePushToggle = useCallback(
    async (enabled: boolean) => {
      setIsUpdatingTaskDonePush(true);

      try {
        await setTaskDonePushEnabled.mutateAsync(enabled);
        if (enabled) {
          const result = await setupBrowserPushNotifications();
          if (result === "subscribed") {
            toast.success("Task completion notifications enabled");
          } else if (result === "permission-denied") {
            toast.error("Browser notification permission was denied");
          } else if (result === "unsupported") {
            toast.error("Browser push notifications are not supported here");
          } else {
            toast.error("Notifications were enabled, but browser push setup did not complete");
          }
        } else {
          await unregisterBrowserPushSubscription();
          toast.success("Task completion notifications disabled");
        }
      } catch (error) {
        console.error("Failed to update task completion notifications:", error);
        toast.error("Failed to update notifications");
      } finally {
        setIsUpdatingTaskDonePush(false);
      }
    },
    [setTaskDonePushEnabled],
  );

  const user = sessionData?.user;
  const savedTimezone = currentUser?.timezone ?? "";
  const taskDonePushEnabled = currentUser?.taskDonePushEnabled ?? false;
  const timezoneDiffers =
    Boolean(savedTimezone) && Boolean(browserTimezone) && savedTimezone !== browserTimezone;

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (status === "error" || !user) {
    return (
      <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">
        Unable to load your account. Please try again.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">General Settings</h2>
        <p className="text-muted-foreground mt-1 text-sm">Manage your account information.</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium">Email</label>
            <Input type="email" value={user.email} disabled className="bg-muted/50" />
            <p className="text-muted-foreground mt-1 text-xs">Email cannot be changed.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium">First name</label>
              <Input
                type="text"
                value={firstName}
                onChange={handleFirstNameChange}
                placeholder="Enter your first name"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Last name</label>
              <Input
                type="text"
                value={lastName}
                onChange={handleLastNameChange}
                placeholder="Enter your last name"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Phone number</label>
            <PhoneInput
              defaultCountry="US"
              international
              countryCallingCodeEditable={false}
              value={phoneNumber}
              onChange={handlePhoneNumberChange}
              placeholder="Enter your phone number"
            />
            {phoneNumber ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={handleRemovePhoneNumber}
                disabled={removingPhone}
              >
                {removingPhone ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Removing...
                  </>
                ) : (
                  "Remove phone number"
                )}
              </Button>
            ) : null}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Timezone</label>
            <TimezoneSelect
              value={timezoneInput}
              onChange={handleTimezoneChange}
              styles={timezoneSelectStyles}
              placeholder="Select your timezone..."
            />
            {setUserTimezone.isPending && (
              <p className="text-muted-foreground mt-1 inline-flex items-center gap-1 text-xs">
                <Loader2 className="inline h-3 w-3 animate-spin" /> Saving...
              </p>
            )}
            {timezoneDiffers ? (
              <div className="mt-3 flex items-center gap-3 text-sm">
                <p className="text-muted-foreground">
                  Browser detects <strong className="text-foreground">{browserTimezone}</strong>
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleUseBrowserTimezone}
                  disabled={setUserTimezone.isPending}
                >
                  Use browser timezone
                </Button>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium">Task completion notifications</label>
                <p className="text-muted-foreground text-sm">
                  Enable browser push notifications when a CmdClaw task finishes. Off by default.
                </p>
              </div>
              <Switch
                checked={taskDonePushEnabled}
                onCheckedChange={handleTaskDonePushToggle}
                disabled={isUpdatingTaskDonePush}
                aria-label="Enable task completion notifications"
              />
            </div>
          </div>

          {/* Email forwarding settings intentionally hidden for now. */}
        </div>

        <Button type="submit" disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            "Save changes"
          )}
        </Button>
      </form>
    </div>
  );
}
