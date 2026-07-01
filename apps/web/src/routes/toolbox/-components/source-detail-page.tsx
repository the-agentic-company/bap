import {
  useNavigate,
  useParams as useTanStackParams,
  useRouterState,
} from "@tanstack/react-router";
import type { ChangeEvent } from "react";
import { T, useGT } from "gt-react";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { WorkspaceMcpServerListItem } from "@/components/executor-source-form";
import { WorkspaceMcpServerLogo } from "@/components/executor-source-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatOAuthConnectionError } from "@/lib/oauth-error-message";
import { useGalienStatus, useConnectGalien, useDisconnectGalien } from "@/orpc/hooks/integrations";
import {
  useWorkspaceMcpServerList,
  useDeleteWorkspaceMcpServer,
  useStartWorkspaceMcpServerOAuth,
  useUpdateWorkspaceMcpServer,
  useSetWorkspaceMcpServerCredential,
  useDisconnectWorkspaceMcpServerCredential,
} from "@/orpc/hooks/workspace-mcp-servers";
import { formatCredentialExpiry, toDateInputValue } from "./credential-expiry";
import { AppLink } from "../-lib/app-link";

export function SourceDetailPage() {
  const t = useGT();

  const { id } = useTanStackParams({ strict: false, shouldThrow: false }) as { id?: string };
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const searchParams = useMemo(() => new URLSearchParams(searchStr ?? ""), [searchStr]);
  const navigate = useNavigate();

  const { data, isLoading } = useWorkspaceMcpServerList();
  const updateSource = useUpdateWorkspaceMcpServer();
  const deleteSource = useDeleteWorkspaceMcpServer();
  const startOAuth = useStartWorkspaceMcpServerOAuth();
  const setCredential = useSetWorkspaceMcpServerCredential();
  const disconnectCredential = useDisconnectWorkspaceMcpServerCredential();
  const { data: galienStatus } = useGalienStatus();
  const connectGalien = useConnectGalien();
  const disconnectGalien = useDisconnectGalien();

  const isWorkspaceAdmin = data?.membershipRole === "admin" || data?.membershipRole === "owner";
  const source = useMemo(
    () => data?.sources?.find((s: WorkspaceMcpServerListItem) => s.id === id) ?? null,
    [data?.sources, id],
  );

  const [secret, setSecret] = useState("");
  const [credDisplayName, setCredDisplayName] = useState("");
  const [credExpiresAt, setCredExpiresAt] = useState("");
  const [galienUsername, setGalienUsername] = useState("");
  const [galienPassword, setGalienPassword] = useState("");
  const isManagedSource = Boolean(source?.internalKey);
  const isGalienSource = source?.internalKey === "galien";
  const managedSourceAction = useMemo(() => {
    if (!source?.internalKey) {
      return null;
    }

    if (source.internalKey === "modulr") {
      return {
        href: "/internal/mcp",
        connectedLabel: "Manage Modulr connection",
        disconnectedLabel: "Configure Modulr",
      };
    }

    if (source.internalKey === "gmail") {
      return {
        href: "/toolbox",
        connectedLabel: "Manage Gmail connection",
        disconnectedLabel: "Connect Gmail",
      };
    }

    return {
      href: "/internal/mcp",
      connectedLabel: `Manage ${source.name}`,
      disconnectedLabel: `Configure ${source.name}`,
    };
  }, [source]);
  const authLabel =
    source?.authType === "none"
      ? "None"
      : source?.authType === "bearer"
        ? "Bearer token"
        : source?.authType === "oauth2"
          ? "OAuth 2.0"
          : "API key";

  const handleSecretChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setSecret(e.target.value);
  }, []);

  const handleCredDisplayNameChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setCredDisplayName(e.target.value);
  }, []);

  const handleCredExpiresAtChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setCredExpiresAt(e.target.value);
  }, []);

  const handleGalienUsernameChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setGalienUsername(e.target.value);
  }, []);

  const handleGalienPasswordChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setGalienPassword(e.target.value);
  }, []);

  useEffect(() => {
    if (source) {
      setCredDisplayName(source.credentialDisplayName ?? "");
      setCredExpiresAt(toDateInputValue(source.credentialExpiresAt));
    }
  }, [source]);

  useEffect(() => {
    const oauthStatus = searchParams.get("oauth");
    if (!oauthStatus) {
      return;
    }

    if (oauthStatus === "success") {
      toast.success(t("OAuth connected."));
    } else {
      toast.error(formatOAuthConnectionError(searchParams.get("oauth_error")));
    }

    void navigate({ to: "/toolbox/sources/$id", params: { id: id ?? "" }, replace: true });
  }, [id, navigate, searchParams, t]);

  const handleToggleEnabled = useCallback(
    async (enabled: boolean) => {
      if (!source) {
        return;
      }
      try {
        await updateSource.mutateAsync({
          id: source.id,
          kind: source.kind,
          name: source.name,
          namespace: source.namespace,
          endpoint: source.endpoint,
          specUrl: source.specUrl,
          transport: source.transport,
          headers: source.headers ?? undefined,
          queryParams: source.queryParams ?? undefined,
          defaultHeaders: source.defaultHeaders ?? undefined,
          authType: source.authType,
          authHeaderName: source.authHeaderName,
          authQueryParam: source.authQueryParam,
          authPrefix: source.authPrefix,
          enabled,
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to update source.");
      }
    },
    [source, updateSource],
  );

  const handleDelete = useCallback(async () => {
    if (!source) {
      return;
    }
    if (!confirm(`Delete "${source.name}"? This cannot be undone.`)) {
      return;
    }
    try {
      await deleteSource.mutateAsync(source.id);
      toast.success(t("Source deleted."));
      void navigate({ to: "/toolbox" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete source.");
    }
  }, [deleteSource, navigate, source, t]);

  const handleSaveCredential = useCallback(async () => {
    if (!source) {
      return;
    }
    const trimmedSecret = secret.trim();
    if (!trimmedSecret) {
      toast.error(t("Enter a secret first."));
      return;
    }
    try {
      await setCredential.mutateAsync({
        workspaceMcpServerId: source.id,
        secret: trimmedSecret,
        displayName: credDisplayName.trim(),
        expiresAt: credExpiresAt || null,
      });
      setSecret("");
      toast.success(t("Credential saved."));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save credential.");
    }
  }, [credDisplayName, credExpiresAt, secret, setCredential, source, t]);

  const handleStartOAuth = useCallback(async () => {
    if (!source) {
      return;
    }

    try {
      const result = await startOAuth.mutateAsync({
        workspaceMcpServerId: source.id,
        redirectUrl: window.location.href,
      });
      window.location.assign(result.authUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start OAuth.");
    }
  }, [source, startOAuth]);

  const credentialExpiryLabel = formatCredentialExpiry(source?.credentialExpiresAt);

  const handleDisconnectCredential = useCallback(async () => {
    if (!source) {
      return;
    }
    try {
      await disconnectCredential.mutateAsync(source.id);
      toast.success(t("Credential disconnected."));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to disconnect credential.");
    }
  }, [disconnectCredential, source, t]);

  const handleConnectGalien = useCallback(async () => {
    const username = galienUsername.trim();
    const password = galienPassword.trim();
    if (!username || !password) {
      toast.error(t("Enter your Galien username and password."));
      return;
    }

    try {
      await connectGalien.mutateAsync({ username, password });
      setGalienPassword("");
      toast.success(t("Galien connected."));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to connect Galien.");
    }
  }, [connectGalien, galienPassword, galienUsername, t]);

  const handleDisconnectGalien = useCallback(async () => {
    try {
      await disconnectGalien.mutateAsync();
      setGalienUsername("");
      setGalienPassword("");
      toast.success(t("Galien disconnected."));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to disconnect Galien.");
    }
  }, [disconnectGalien, t]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!source) {
    return (
      <div className="py-24 text-center">
        <p className="text-muted-foreground text-sm">
          <T>Source not found.</T>
        </p>
        <AppLink href="/toolbox" className="text-brand mt-4 inline-block text-sm hover:underline">
          <T>Back to Toolbox</T>
        </AppLink>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8">
        <AppLink
          href="/toolbox"
          className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <T>Back to Toolbox</T>
        </AppLink>
      </div>

      <section className="bg-card rounded-xl border p-6 shadow-sm">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <WorkspaceMcpServerLogo
              kind={source.kind}
              endpoint={source.endpoint}
              className="h-14 w-14 shrink-0 rounded-xl"
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{source.name}</h1>
                <span className="text-muted-foreground text-sm">MCP</span>
                <span className="text-muted-foreground text-sm">·</span>
                <span className="text-muted-foreground font-mono text-sm">{source.namespace}</span>
              </div>
              <p className="text-muted-foreground mt-2 text-sm break-all">{source.endpoint}</p>
              <p className="text-muted-foreground mt-2 text-sm">
                {source.connected ? "Connected" : "Not connected"} · {authLabel}
              </p>
              {source.connected && credentialExpiryLabel ? (
                <p className="text-muted-foreground mt-1 text-sm">{credentialExpiryLabel}</p>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2 sm:ml-6">
            {isWorkspaceAdmin ? (
              <div className="mr-2 flex items-center gap-2">
                <span className="text-muted-foreground text-xs font-medium">
                  <T>Enabled</T>
                </span>
                <Switch
                  checked={source.enabled}
                  disabled={updateSource.isPending}
                  onCheckedChange={handleToggleEnabled}
                />
              </div>
            ) : null}

            {!isManagedSource && isWorkspaceAdmin ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleteSource.isPending}
                  className="text-destructive hover:text-destructive px-2"
                  aria-label={t("Delete source")}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            ) : isManagedSource ? (
              <span className="text-muted-foreground text-xs">
                <T>Managed by Bap</T>
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-6">
          {isGalienSource ? (
            <div className="mt-5 space-y-4">
              <div>
                <p className="text-sm font-medium">
                  {galienStatus?.connected
                    ? `Connected${galienStatus.displayName ? ` as ${galienStatus.displayName}` : ""}`
                    : "Connect Galien"}
                </p>
                {galienStatus?.connected && galienStatus.validatedAt ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    <T>Last validated</T> {new Date(galienStatus.validatedAt).toLocaleString()}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  value={galienUsername}
                  onChange={handleGalienUsernameChange}
                  placeholder={t("Galien username")}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <Input
                  value={galienPassword}
                  onChange={handleGalienPasswordChange}
                  placeholder={galienStatus?.connected ? "Update password" : "Galien password"}
                  type="password"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  onClick={handleConnectGalien}
                  disabled={connectGalien.isPending}
                >
                  {connectGalien.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {galienStatus?.connected ? "Update Galien credentials" : "Connect Galien"}
                </Button>

                {galienStatus?.connected ? (
                  <Button
                    variant="ghost"
                    onClick={handleDisconnectGalien}
                    disabled={disconnectGalien.isPending}
                  >
                    <T>Disconnect</T>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : source.internalKey ? (
            <div className="mt-5 flex items-center gap-3">
              <Button asChild variant="outline">
                <AppLink href={managedSourceAction?.href ?? "/toolbox"}>
                  {source.connected
                    ? (managedSourceAction?.connectedLabel ?? "Manage connection")
                    : (managedSourceAction?.disconnectedLabel ?? "Configure connection")}
                </AppLink>
              </Button>
            </div>
          ) : source.authType === "oauth2" ? (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={handleStartOAuth} disabled={startOAuth.isPending}>
                {startOAuth.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {source.connected ? "Reconnect OAuth" : "Connect OAuth"}
              </Button>

              {source.connected ? (
                <Button
                  variant="ghost"
                  onClick={handleDisconnectCredential}
                  disabled={disconnectCredential.isPending}
                >
                  <T>Disconnect</T>
                </Button>
              ) : null}
            </div>
          ) : source.authType !== "none" ? (
            <div className="mt-5 space-y-4">
              {source.connected && credentialExpiryLabel ? (
                <p className="text-muted-foreground text-xs">{credentialExpiryLabel}</p>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                <Input
                  value={secret}
                  onChange={handleSecretChange}
                  placeholder={source.connected ? "Update your secret" : "Your API key or token"}
                  type="password"
                />
                <Input
                  value={credDisplayName}
                  onChange={handleCredDisplayNameChange}
                  placeholder={t("Label (optional)")}
                />
                <Input
                  value={credExpiresAt}
                  onChange={handleCredExpiresAtChange}
                  placeholder={t("Expiration date")}
                  type="date"
                  className="sm:col-start-2"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  onClick={handleSaveCredential}
                  disabled={setCredential.isPending}
                >
                  {setCredential.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {source.connected ? "Update secret" : "Connect"}
                </Button>

                {source.connected ? (
                  <Button
                    variant="ghost"
                    onClick={handleDisconnectCredential}
                    disabled={disconnectCredential.isPending}
                  >
                    <T>Disconnect</T>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
