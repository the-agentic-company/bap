import { createFileRoute } from "@tanstack/react-router";
import { T, useGT } from "gt-react";
import { Loader2 } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAppLocale } from "@/components/general-translation-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { authClient } from "@/lib/auth-client";
import { useCurrentUser, useSetUserTimezone } from "@/orpc/hooks/user";

export const Route = createFileRoute("/settings/")({
  head: () => ({ meta: [{ title: "General Settings - CmdClaw" }] }),
  component: SettingsPage,
});

const AccountContactFields = lazy(() => import("./-account-contact-fields"));

type SessionData = Awaited<ReturnType<typeof authClient.getSession>>["data"];

const SETTINGS_LOCALE_NAMES = {
  en: "English",
  fr: "Français",
} as const;

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
        <div className="bg-muted mb-2 h-5 w-28 rounded" />
        <div className="bg-muted/30 h-9 rounded-md border" />
      </div>
      <div>
        <div className="bg-muted mb-2 h-5 w-20 rounded" />
        <div className="bg-muted/30 h-9 rounded-md border" />
      </div>
    </>
  );
}

const accountContactFieldsFallback = <AccountContactFieldsFallback />;

function SettingsPage() {
  const t = useGT();

  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingPhone, setRemovingPhone] = useState(false);
  const [timezoneInput, setTimezoneInput] = useState("");
  const { data: currentUser } = useCurrentUser();
  const setUserTimezone = useSetUserTimezone();
  const { locale, locales, setLocale } = useAppLocale();
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
        toast.success(t("Settings saved"));
      } catch (error) {
        console.error("Failed to update user:", error);
        toast.error(t("Failed to save settings"));
      } finally {
        setSaving(false);
      }
    },
    [firstName, lastName, phoneNumber, t],
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
      toast.success(t("Phone number removed"));
    } catch (error) {
      console.error("Failed to remove phone number:", error);
      toast.error(t("Failed to remove phone number"));
    } finally {
      setRemovingPhone(false);
    }
  }, [t]);

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
        .then(() => toast.success(t("Timezone updated")))
        .catch((error) => {
          console.error("Failed to update timezone:", error);
          toast.error(t("Failed to update timezone"));
        });
    },
    [setUserTimezone, t],
  );

  const handleUseBrowserTimezone = useCallback(() => {
    if (!browserTimezone) {
      return;
    }
    setTimezoneInput(browserTimezone);
    void setUserTimezone
      .mutateAsync(browserTimezone)
      .then(() => toast.success(t("Timezone updated")))
      .catch((error) => {
        console.error("Failed to update timezone:", error);
        toast.error(t("Failed to update timezone"));
      });
  }, [browserTimezone, setUserTimezone, t]);

  const handleLanguageChange = useCallback(
    (nextLocale: string) => {
      setLocale(nextLocale);
      toast.success(t("Language updated"));
    },
    [setLocale, t],
  );

  const user = sessionData?.user;
  const savedTimezone = currentUser?.timezone ?? "";
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
        <T>Unable to load your account. Please try again.</T>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">
          <T>General Settings</T>
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          <T>Manage your account information.</T>
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium">
              <T>Email</T>
            </label>
            <Input type="email" value={user.email} disabled className="bg-muted/50" />
            <p className="text-muted-foreground mt-1 text-xs">
              <T>Email cannot be changed.</T>
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium">
                <T>First name</T>
              </label>
              <Input
                type="text"
                value={firstName}
                onChange={handleFirstNameChange}
                placeholder={t("Enter your first name")}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                <T>Last name</T>
              </label>
              <Input
                type="text"
                value={lastName}
                onChange={handleLastNameChange}
                placeholder={t("Enter your last name")}
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

          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
            <div>
              <label className="block text-sm font-medium">
                <T>Language</T>
              </label>
            </div>
            <Select value={locale} onValueChange={handleLanguageChange}>
              <SelectTrigger aria-label={t("Language")} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {locales.map((option) => (
                  <SelectItem key={option} value={option}>
                    {SETTINGS_LOCALE_NAMES[option as keyof typeof SETTINGS_LOCALE_NAMES] ?? option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Email forwarding settings intentionally hidden for now. */}
        </div>

        <Button type="submit" disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              <T>Saving...</T>
            </>
          ) : (
            <T>Save changes</T>
          )}
        </Button>
      </form>
    </div>
  );
}
