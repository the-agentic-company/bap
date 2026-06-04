import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2, Server, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  useAdminAddGalienAccess,
  useAdminAddModulrAccess,
  useAdminGalienAccess,
  useAdminModulrAccess,
  useAdminRemoveGalienAccess,
  useAdminRemoveModulrAccess,
  useAdminUpdateGalienAccessTargetEnv,
  useConnectModulr,
  useDisconnectModulr,
  useModulrStatus,
  useTestModulrConnection,
} from "@/orpc/hooks/integrations";
import { useAdminWorkspaces } from "@/orpc/hooks/workspace";
import { AppImage } from "./-lib/app-image";

export const Route = createFileRoute("/admin/mcp")({
  head: () => ({ meta: [{ title: "MCP Servers - CmdClaw" }] }),
  component: AdminMcpPage,
});

type ModulrFormState = {
  database: string;
  clientId: string;
  clientSecret: string;
  locale: "fr" | "en";
  baseUrl: string;
};

type GalienTargetEnv = "prod" | "preprod";

const DEFAULT_FORM: ModulrFormState = {
  database: "",
  clientId: "",
  clientSecret: "",
  locale: "fr",
  baseUrl: "https://app.modulr-courtage.fr",
};

function AccessEntryButton({
  id,
  email,
  targetEnv,
  onTargetEnvChange,
  onRemove,
}: {
  id: string;
  email: string;
  targetEnv?: GalienTargetEnv;
  onTargetEnvChange?: (id: string, targetEnv: GalienTargetEnv) => void;
  onRemove: (id: string, email: string) => void;
}) {
  const handleClick = useCallback(() => onRemove(id, email), [email, id, onRemove]);
  const handleTargetEnvChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      onTargetEnvChange?.(id, event.target.value as GalienTargetEnv);
    },
    [id, onTargetEnvChange],
  );

  return (
    <div className="bg-muted flex items-center gap-2 rounded-md px-2 py-1 text-xs">
      <span>{email}</span>
      {targetEnv && onTargetEnvChange ? (
        <select
          aria-label={`Galien target environment for ${email}`}
          value={targetEnv}
          onChange={handleTargetEnvChange}
          className="bg-background rounded border px-1 py-0.5 text-xs"
        >
          <option value="prod">Production</option>
          <option value="preprod">Preproduction</option>
        </select>
      ) : null}
      <button type="button" onClick={handleClick} className="hover:text-destructive">
        ×
      </button>
    </div>
  );
}

function McpAccessPanel({
  name,
  workspaceId,
  email,
  entries,
  isLoading,
  isPending,
  targetEnv,
  onEmailChange,
  onTargetEnvChange,
  onAdd,
  onRemove,
  onEntryTargetEnvChange,
}: {
  name: "Galien" | "Modulr";
  workspaceId: string | null;
  email: string;
  entries: Array<{ id: string; email: string; targetEnv?: GalienTargetEnv }>;
  isLoading: boolean;
  isPending: boolean;
  targetEnv?: GalienTargetEnv;
  onEmailChange: (value: string) => void;
  onTargetEnvChange?: (value: GalienTargetEnv) => void;
  onAdd: (event: React.FormEvent) => void;
  onRemove: (id: string, email: string) => void;
  onEntryTargetEnvChange?: (id: string, targetEnv: GalienTargetEnv) => void;
}) {
  const handleEmailChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => onEmailChange(event.target.value),
    [onEmailChange],
  );
  const handleTargetEnvChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      onTargetEnvChange?.(event.target.value as GalienTargetEnv);
    },
    [onTargetEnvChange],
  );

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-semibold">{name}</h4>
        <p className="text-muted-foreground mt-1 text-xs">
          Grant {name} MCP access to individual emails in the selected workspace.
        </p>
      </div>
      <form onSubmit={onAdd} className="flex flex-col gap-3 sm:flex-row">
        <Input
          type="email"
          placeholder="user@company.com"
          value={email}
          onChange={handleEmailChange}
          className="sm:max-w-xs"
        />
        {targetEnv && onTargetEnvChange ? (
          <select
            aria-label="Galien target environment"
            value={targetEnv}
            onChange={handleTargetEnvChange}
            className="bg-background rounded-md border px-3 py-2 text-sm"
          >
            <option value="prod">Production</option>
            <option value="preprod">Preproduction</option>
          </select>
        ) : null}
        <Button type="submit" size="sm" disabled={!workspaceId || isPending}>
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Add ${name}`}
        </Button>
      </form>
      <div className="flex min-h-7 flex-wrap gap-2">
        {isLoading ? (
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
        ) : entries.length > 0 ? (
          entries.map((entry) => (
            <AccessEntryButton
              key={entry.id}
              id={entry.id}
              email={entry.email}
              targetEnv={entry.targetEnv}
              onTargetEnvChange={onEntryTargetEnvChange}
              onRemove={onRemove}
            />
          ))
        ) : (
          <p className="text-muted-foreground text-xs">No {name} users enabled here.</p>
        )}
      </div>
    </div>
  );
}

function AdminMcpPage() {
  const { data: status, isLoading, refetch } = useModulrStatus();
  const { data: adminWorkspaces } = useAdminWorkspaces();
  const testConnection = useTestModulrConnection();
  const connectModulr = useConnectModulr();
  const disconnectModulr = useDisconnectModulr();
  const addGalienAccess = useAdminAddGalienAccess();
  const removeGalienAccess = useAdminRemoveGalienAccess();
  const updateGalienAccessTargetEnv = useAdminUpdateGalienAccessTargetEnv();
  const addModulrAccess = useAdminAddModulrAccess();
  const removeModulrAccess = useAdminRemoveModulrAccess();
  const [form, setForm] = useState<ModulrFormState>(DEFAULT_FORM);
  const [accessWorkspaceId, setAccessWorkspaceId] = useState<string | null>(null);
  const [galienEmail, setGalienEmail] = useState("");
  const [galienTargetEnv, setGalienTargetEnv] = useState<GalienTargetEnv>("prod");
  const [modulrEmail, setModulrEmail] = useState("");
  const [galienActionPending, setGalienActionPending] = useState(false);
  const [modulrActionPending, setModulrActionPending] = useState(false);
  const { data: galienAccessEntries, isLoading: isGalienAccessLoading } =
    useAdminGalienAccess(accessWorkspaceId);
  const { data: modulrAccessEntries, isLoading: isModulrAccessLoading } =
    useAdminModulrAccess(accessWorkspaceId);
  const visibleGalienAccessEntries = useMemo(
    () => galienAccessEntries ?? [],
    [galienAccessEntries],
  );
  const visibleModulrAccessEntries = useMemo(
    () => modulrAccessEntries ?? [],
    [modulrAccessEntries],
  );

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

  useEffect(() => {
    if (!accessWorkspaceId && adminWorkspaces?.[0]?.id) {
      setAccessWorkspaceId(adminWorkspaces[0].id);
    }
  }, [adminWorkspaces, accessWorkspaceId]);

  const updateField = useCallback(
    (field: keyof ModulrFormState) => (event: React.ChangeEvent<HTMLInputElement>) => {
      setForm((current) => ({ ...current, [field]: event.target.value }));
    },
    [],
  );

  const handleLocaleChange = useCallback((value: string) => {
    setForm((current) => ({ ...current, locale: value as "fr" | "en" }));
  }, []);

  const payload = useCallback(() => {
    const next = {
      database: form.database.trim(),
      clientId: form.clientId.trim(),
      clientSecret: form.clientSecret.trim(),
      locale: form.locale,
      baseUrl: form.baseUrl.trim() || DEFAULT_FORM.baseUrl,
    };
    if (!next.database || !next.clientId || !next.clientSecret) {
      toast.error("Database, client ID, and client secret are required.");
      return null;
    }
    return next;
  }, [form]);

  const handleTest = useCallback(async () => {
    const input = payload();
    if (!input) {
      return;
    }
    try {
      await testConnection.mutateAsync(input);
      toast.success("Modulr connection works.");
    } catch (error) {
      console.error("Failed to test Modulr connection:", error);
      toast.error("Modulr connection failed.");
    }
  }, [payload, testConnection]);

  const handleSave = useCallback(async () => {
    const input = payload();
    if (!input) {
      return;
    }
    try {
      await connectModulr.mutateAsync(input);
      setForm((current) => ({ ...current, clientSecret: "" }));
      await refetch();
      toast.success("Modulr MCP credentials saved.");
    } catch (error) {
      console.error("Failed to save Modulr connection:", error);
      toast.error("Failed to save Modulr credentials.");
    }
  }, [connectModulr, payload, refetch]);

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnectModulr.mutateAsync();
      setForm(DEFAULT_FORM);
      await refetch();
      toast.success("Modulr MCP disconnected.");
    } catch (error) {
      console.error("Failed to disconnect Modulr:", error);
      toast.error("Failed to disconnect Modulr.");
    }
  }, [disconnectModulr, refetch]);

  const handleAccessWorkspaceChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    setAccessWorkspaceId(event.target.value || null);
  }, []);

  const handleAddGalienAccess = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const email = galienEmail.trim().toLowerCase();
      if (!accessWorkspaceId || !email) {
        return;
      }

      setGalienActionPending(true);
      try {
        await addGalienAccess.mutateAsync({
          workspaceId: accessWorkspaceId,
          email,
          targetEnv: galienTargetEnv,
        });
        setGalienEmail("");
        toast.success(`Enabled Galien for ${email}.`);
      } catch (error) {
        console.error("Failed to enable Galien access:", error);
        toast.error("Failed to enable Galien access.");
      } finally {
        setGalienActionPending(false);
      }
    },
    [accessWorkspaceId, addGalienAccess, galienEmail, galienTargetEnv],
  );

  const handleUpdateGalienAccessTargetEnv = useCallback(
    async (id: string, targetEnv: GalienTargetEnv) => {
      if (!accessWorkspaceId) {
        return;
      }
      try {
        await updateGalienAccessTargetEnv.mutateAsync({
          id,
          workspaceId: accessWorkspaceId,
          targetEnv,
        });
        toast.success("Updated Galien target environment.");
      } catch (error) {
        console.error("Failed to update Galien target environment:", error);
        toast.error("Failed to update Galien target environment.");
      }
    },
    [accessWorkspaceId, updateGalienAccessTargetEnv],
  );

  const handleRemoveGalienAccess = useCallback(
    async (id: string, email: string) => {
      if (!accessWorkspaceId) {
        return;
      }
      try {
        await removeGalienAccess.mutateAsync({ id, workspaceId: accessWorkspaceId });
        toast.success(`Removed Galien access for ${email}.`);
      } catch (error) {
        console.error("Failed to remove Galien access:", error);
        toast.error("Failed to remove Galien access.");
      }
    },
    [accessWorkspaceId, removeGalienAccess],
  );

  const handleAddModulrAccess = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const email = modulrEmail.trim().toLowerCase();
      if (!accessWorkspaceId || !email) {
        return;
      }

      setModulrActionPending(true);
      try {
        await addModulrAccess.mutateAsync({ workspaceId: accessWorkspaceId, email });
        setModulrEmail("");
        toast.success(`Enabled Modulr for ${email}.`);
      } catch (error) {
        console.error("Failed to enable Modulr access:", error);
        toast.error("Failed to enable Modulr access.");
      } finally {
        setModulrActionPending(false);
      }
    },
    [accessWorkspaceId, addModulrAccess, modulrEmail],
  );

  const handleRemoveModulrAccess = useCallback(
    async (id: string, email: string) => {
      if (!accessWorkspaceId) {
        return;
      }
      try {
        await removeModulrAccess.mutateAsync({ id, workspaceId: accessWorkspaceId });
        toast.success(`Removed Modulr access for ${email}.`);
      } catch (error) {
        console.error("Failed to remove Modulr access:", error);
        toast.error("Failed to remove Modulr access.");
      }
    },
    [accessWorkspaceId, removeModulrAccess],
  );

  const isConnected = Boolean(status?.connected);
  const isAllowed = status?.allowed !== false;
  const isBusy = testConnection.isPending || connectModulr.isPending || disconnectModulr.isPending;

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-muted flex h-11 w-11 items-center justify-center rounded-lg border">
            <AppImage
              src="/integrations/mcp.svg"
              alt="MCP logo"
              width={24}
              height={24}
              className="dark:invert"
            />
          </div>
          <div>
            <h2 className="text-xl font-semibold">MCP Servers</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Configure managed MCP servers that CmdClaw agents can use inside the active workspace.
            </p>
          </div>
        </div>
      </div>

      <div className="bg-card mb-4 rounded-lg border p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold">MCP access</h3>
            <p className="text-muted-foreground mt-1 text-sm">
              Allow specific users to connect workspace-scoped MCP servers.
            </p>
          </div>
          <select
            value={accessWorkspaceId ?? ""}
            onChange={handleAccessWorkspaceChange}
            className="bg-background min-w-64 rounded-md border px-3 py-2 text-sm"
          >
            {(adminWorkspaces ?? []).map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <McpAccessPanel
            name="Galien"
            workspaceId={accessWorkspaceId}
            email={galienEmail}
            targetEnv={galienTargetEnv}
            entries={visibleGalienAccessEntries}
            isLoading={isGalienAccessLoading}
            isPending={galienActionPending}
            onEmailChange={setGalienEmail}
            onTargetEnvChange={setGalienTargetEnv}
            onAdd={handleAddGalienAccess}
            onRemove={handleRemoveGalienAccess}
            onEntryTargetEnvChange={handleUpdateGalienAccessTargetEnv}
          />
          <McpAccessPanel
            name="Modulr"
            workspaceId={accessWorkspaceId}
            email={modulrEmail}
            entries={visibleModulrAccessEntries}
            isLoading={isModulrAccessLoading}
            isPending={modulrActionPending}
            onEmailChange={setModulrEmail}
            onAdd={handleAddModulrAccess}
            onRemove={handleRemoveModulrAccess}
          />
        </div>
      </div>

      <div className="bg-card rounded-lg border p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="bg-muted flex h-12 w-12 items-center justify-center rounded-lg border text-sm font-semibold">
              M
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">Modulr</h3>
                {isLoading ? (
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-xs font-medium">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Checking status
                  </span>
                ) : isConnected ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Connected
                  </span>
                ) : !isAllowed ? (
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-xs font-medium">
                    <Server className="h-3.5 w-3.5" />
                    Not enabled
                  </span>
                ) : (
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-xs font-medium">
                    <Server className="h-3.5 w-3.5" />
                    Not connected
                  </span>
                )}
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                Save the company Modulr API connection used by the `modulr` MCP server to resolve
                customers and read attached documents.
              </p>
              {!isAllowed ? (
                <p className="text-muted-foreground mt-3 text-xs">
                  Modulr access must be granted for your email in this workspace first.
                </p>
              ) : null}
              {isConnected ? (
                <p className="text-muted-foreground mt-3 text-xs">
                  Connected to `{status?.database}` as `{status?.clientId}`.
                </p>
              ) : null}
            </div>
          </div>

          {isConnected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              disabled={disconnectModulr.isPending}
            >
              {disconnectModulr.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Disconnect
            </Button>
          ) : null}
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Database</span>
            <Input
              value={form.database}
              onChange={updateField("database")}
              placeholder="assurhelium"
              autoComplete="off"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Client ID</span>
            <Input
              value={form.clientId}
              onChange={updateField("clientId")}
              placeholder="api"
              autoComplete="off"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Client secret</span>
            <Input
              type="password"
              value={form.clientSecret}
              onChange={updateField("clientSecret")}
              placeholder={
                isConnected ? "Enter a new secret to replace credentials" : "Paste secret"
              }
              autoComplete="off"
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-sm font-medium">Locale</span>
            <Select value={form.locale} onValueChange={handleLocaleChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fr">French</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="space-y-1.5 md:col-span-2">
            <span className="text-sm font-medium">Base URL</span>
            <Input
              value={form.baseUrl}
              onChange={updateField("baseUrl")}
              placeholder="https://app.modulr-courtage.fr"
              autoComplete="off"
            />
          </label>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button variant="outline" onClick={handleTest} disabled={isBusy || !isAllowed}>
            {testConnection.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Test connection
          </Button>
          <Button onClick={handleSave} disabled={isBusy || !isAllowed}>
            {connectModulr.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isConnected ? "Replace credentials" : "Save credentials"}
          </Button>
        </div>
      </div>
    </div>
  );
}
