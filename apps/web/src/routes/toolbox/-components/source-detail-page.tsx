"use client";

import type { ChangeEvent } from "react";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type { WorkspaceMcpServerListItem } from "@/components/executor-source-form";
import { WorkspaceMcpServerLogo } from "@/components/executor-source-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatOAuthConnectionError } from "@/lib/oauth-error-message";
import {
  useWorkspaceMcpServerList,
  useDeleteWorkspaceMcpServer,
  useStartWorkspaceMcpServerOAuth,
  useUpdateWorkspaceMcpServer,
  useSetWorkspaceMcpServerCredential,
  useDisconnectWorkspaceMcpServerCredential,
  useGalienStatus,
  useConnectGalien,
  useDisconnectGalien,
} from "@/orpc/hooks";
import { AppLink } from "../-lib/app-link";
import { useParams, useRouter, useSearchParams } from "../-lib/next-navigation-compat";

export function SourceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

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
        href: "/admin/mcp",
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
      href: "/admin/mcp",
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

  const handleGalienUsernameChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setGalienUsername(e.target.value);
  }, []);

  const handleGalienPasswordChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setGalienPassword(e.target.value);
  }, []);

  useEffect(() => {
    if (source) {
      setCredDisplayName(source.credentialDisplayName ?? "");
    }
  }, [source]);

  useEffect(() => {
    const oauthStatus = searchParams.get("oauth");
    if (!oauthStatus) {
      return;
    }

    if (oauthStatus === "success") {
      toast.success("OAuth connected.");
    } else {
      toast.error(formatOAuthConnectionError(searchParams.get("oauth_error")));
    }

    router.replace(`/toolbox/sources/${id}`);
  }, [id, router, searchParams]);

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
      toast.success("Source deleted.");
      router.push("/toolbox");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete source.");
    }
  }, [deleteSource, router, source]);

  const handleSaveCredential = useCallback(async () => {
    if (!source) {
      return;
    }
    const trimmedSecret = secret.trim();
    if (!trimmedSecret) {
      toast.error("Enter a secret first.");
      return;
    }
    try {
      await setCredential.mutateAsync({
        workspaceMcpServerId: source.id,
        secret: trimmedSecret,
        displayName: credDisplayName.trim(),
      });
      setSecret("");
      toast.success("Credential saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save credential.");
    }
  }, [credDisplayName, secret, setCredential, source]);

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

  const handleDisconnectCredential = useCallback(async () => {
    if (!source) {
      return;
    }
    try {
      await disconnectCredential.mutateAsync(source.id);
      toast.success("Credential disconnected.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to disconnect credential.");
    }
  }, [disconnectCredential, source]);

  const handleConnectGalien = useCallback(async () => {
    const username = galienUsername.trim();
    const password = galienPassword.trim();
    if (!username || !password) {
      toast.error("Enter your Galien username and password.");
      return;
    }

    try {
      await connectGalien.mutateAsync({ username, password });
      setGalienPassword("");
      toast.success("Galien connected.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to connect Galien.");
    }
  }, [connectGalien, galienPassword, galienUsername]);

  const handleDisconnectGalien = useCallback(async () => {
    try {
      await disconnectGalien.mutateAsync();
      setGalienUsername("");
      setGalienPassword("");
      toast.success("Galien disconnected.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to disconnect Galien.");
    }
  }, [disconnectGalien]);

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
        <p className="text-muted-foreground text-sm">Source not found.</p>
        <AppLink href="/toolbox" className="text-brand mt-4 inline-block text-sm hover:underline">
          Back to Toolbox
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
          Back to Toolbox
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
            </div>
          </div>

          <div className="flex items-center gap-2 sm:ml-6">
            {isWorkspaceAdmin ? (
              <div className="mr-2 flex items-center gap-2">
                <span className="text-muted-foreground text-xs font-medium">Enabled</span>
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
                  aria-label="Delete source"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            ) : isManagedSource ? (
              <span className="text-muted-foreground text-xs">Managed by CmdClaw</span>
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
                    Last validated {new Date(galienStatus.validatedAt).toLocaleString()}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  value={galienUsername}
                  onChange={handleGalienUsernameChange}
                  placeholder="Galien username"
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
                    Disconnect
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
                  Disconnect
                </Button>
              ) : null}
            </div>
          ) : source.authType !== "none" ? (
            <div className="mt-5 space-y-4">
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
                  placeholder="Label (optional)"
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
                    Disconnect
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
