import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useConnectModulr,
  useDisconnectModulr,
  useModulrStatus,
  useTestModulrConnection,
} from "@/orpc/hooks/integrations";

type FormState = {
  database: string;
  clientId: string;
  clientSecret: string;
  locale: "fr" | "en";
  baseUrl: string;
};

const DEFAULT_FORM: FormState = {
  database: "",
  clientId: "",
  clientSecret: "",
  locale: "fr",
  baseUrl: "https://app.modulr-courtage.fr",
};

export function ManagedModulrConnection() {
  const { data: status } = useModulrStatus();
  const testConnection = useTestModulrConnection();
  const connectModulr = useConnectModulr();
  const disconnectModulr = useDisconnectModulr();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);

  useEffect(() => {
    if (!status?.connected) {
      return;
    }
    setForm((current) => ({
      ...current,
      database: current.database || status.database || "",
      clientId: current.clientId || status.clientId || "",
      locale: status.locale ?? current.locale,
      baseUrl: current.baseUrl || status.baseUrl || DEFAULT_FORM.baseUrl,
    }));
  }, [status]);

  const updateField = useCallback(
    (field: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) => {
      setForm((current) => ({ ...current, [field]: event.target.value }));
    },
    [],
  );

  const getPayload = useCallback(() => {
    const payload = {
      database: form.database.trim(),
      clientId: form.clientId.trim(),
      clientSecret: form.clientSecret.trim(),
      locale: form.locale,
      baseUrl: form.baseUrl.trim() || DEFAULT_FORM.baseUrl,
    };
    if (!payload.database || !payload.clientId || !payload.clientSecret) {
      toast.error("Database, client ID, and client secret are required.");
      return null;
    }
    return payload;
  }, [form]);

  const handleLocaleChange = useCallback((locale: string) => {
    setForm((current) => ({ ...current, locale: locale as "fr" | "en" }));
  }, []);

  const handleTest = useCallback(async () => {
    const payload = getPayload();
    if (!payload) {
      return;
    }
    try {
      await testConnection.mutateAsync(payload);
      toast.success("Modulr connection works.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Modulr connection failed.");
    }
  }, [getPayload, testConnection]);

  const handleSave = useCallback(async () => {
    const payload = getPayload();
    if (!payload) {
      return;
    }
    try {
      await connectModulr.mutateAsync(payload);
      setForm((current) => ({ ...current, clientSecret: "" }));
      toast.success("Your Modulr authorization is connected.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to connect Modulr.");
    }
  }, [connectModulr, getPayload]);

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnectModulr.mutateAsync();
      setForm(DEFAULT_FORM);
      toast.success("Your Modulr authorization is disconnected.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to disconnect Modulr.");
    }
  }, [disconnectModulr]);

  const isBusy = testConnection.isPending || connectModulr.isPending || disconnectModulr.isPending;

  return (
    <div className="mt-5 space-y-4">
      <div>
        <p className="text-sm font-medium">
          {status?.connected ? "Your Modulr authorization is connected" : "Connect Modulr"}
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          Your credentials are private to you. Other workspace members connect their own
          authorization.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          aria-label="Modulr database"
          value={form.database}
          onChange={updateField("database")}
          placeholder="Database"
          autoComplete="off"
        />
        <Input
          aria-label="Modulr client ID"
          value={form.clientId}
          onChange={updateField("clientId")}
          placeholder="Client ID"
          autoComplete="off"
        />
        <Input
          aria-label="Modulr client secret"
          value={form.clientSecret}
          onChange={updateField("clientSecret")}
          placeholder={status?.connected ? "Enter a new secret to update" : "Client secret"}
          type="password"
          autoComplete="off"
        />
        <Select value={form.locale} onValueChange={handleLocaleChange}>
          <SelectTrigger className="w-full" aria-label="Modulr locale">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fr">French</SelectItem>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
        <Input
          aria-label="Modulr base URL"
          value={form.baseUrl}
          onChange={updateField("baseUrl")}
          placeholder="Base URL"
          autoComplete="off"
          className="sm:col-span-2"
          readOnly
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={handleTest} disabled={isBusy}>
          {testConnection.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          Test connection
        </Button>
        <Button onClick={handleSave} disabled={isBusy}>
          {connectModulr.isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {status?.connected ? "Update credentials" : "Connect Modulr"}
        </Button>
        {status?.connected ? (
          <Button variant="ghost" onClick={handleDisconnect} disabled={isBusy}>
            Disconnect
          </Button>
        ) : null}
      </div>
    </div>
  );
}
