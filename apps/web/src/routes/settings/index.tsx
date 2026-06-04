import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const AccountContactFields = lazy(() => import("./-account-contact-fields"));

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

function AccountContactFieldsFallback() {
  return (
    <>
      <div>
        <div className="mb-2 h-5 w-28 rounded bg-muted" />
        <div className="h-9 rounded-md border bg-muted/30" />
      </div>
      <div>
        <div className="mb-2 h-5 w-20 rounded bg-muted" />
        <div className="h-9 rounded-md border bg-muted/30" />
      </div>
    </>
  );
}

const accountContactFieldsFallback = <AccountContactFieldsFallback />;

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
    (value: string) => {
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

          <Suspense fallback={accountContactFieldsFallback}>
            <AccountContactFields
              browserTimezone={browserTimezone}
              isRemovingPhone={removingPhone}
              isSavingTimezone={setUserTimezone.isPending}
              onPhoneNumberChange={handlePhoneNumberChange}
              onRemovePhoneNumber={handleRemovePhoneNumber}
              onTimezoneChange={handleTimezoneChange}
              onUseBrowserTimezone={handleUseBrowserTimezone}
              phoneNumber={phoneNumber}
              timezoneDiffers={timezoneDiffers}
              timezoneInput={timezoneInput}
            />
          </Suspense>

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
