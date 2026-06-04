import type { ChangeEvent, FormEvent } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type WorkspaceMcpServerFormState,
  DEFAULT_EXECUTOR_SOURCE_FORM,
  buildMutationInputFromForm,
} from "@/components/executor-source-form";
import { WorkspaceMcpServerLogo } from "@/components/executor-source-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inferBrandNameFromEndpoint } from "@/lib/brandfetch";
import {
  useWorkspaceMcpServerList,
  useCreateWorkspaceMcpServer,
  useStartWorkspaceMcpServerOAuth,
  useSetWorkspaceMcpServerCredential,
} from "@/orpc/hooks/workspace-mcp-servers";
import { AppLink } from "../-lib/app-link";
import { useRouter } from "../-lib/next-navigation-compat";

export function NewSourcePage() {
  const router = useRouter();
  const { data, isLoading: listLoading } = useWorkspaceMcpServerList();
  const createSource = useCreateWorkspaceMcpServer();
  const startOAuth = useStartWorkspaceMcpServerOAuth();
  const setCredential = useSetWorkspaceMcpServerCredential();

  const isWorkspaceAdmin = data?.membershipRole === "admin" || data?.membershipRole === "owner";

  const initialForm = useMemo<WorkspaceMcpServerFormState>(() => {
    return {
      ...DEFAULT_EXECUTOR_SOURCE_FORM,
      kind: "mcp",
      transport: "",
      authType: "oauth2",
    };
  }, []);

  const [form, setForm] = useState<WorkspaceMcpServerFormState>(initialForm);
  const isMcpCreate = form.kind === "mcp";
  const inferredName = useMemo(
    () => (isMcpCreate ? (inferBrandNameFromEndpoint(form.endpoint) ?? "") : ""),
    [form.endpoint, isMcpCreate],
  );
  const effectiveMcpName = isMcpCreate ? form.name.trim() || inferredName : form.name.trim();

  const handleNameChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, name: event.target.value }));
  }, []);

  const handleEndpointChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const endpoint = event.target.value;

    setForm((current) => {
      const previousInferredName = inferBrandNameFromEndpoint(current.endpoint) ?? "";
      const nextInferredName = inferBrandNameFromEndpoint(endpoint) ?? "";
      const shouldAutofillName =
        current.kind === "mcp" &&
        (!current.name.trim() || current.name.trim() === previousInferredName);

      return {
        ...current,
        endpoint,
        name: shouldAutofillName ? nextInferredName : current.name,
      };
    });
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      try {
        const sourceForm =
          isMcpCreate && !form.name.trim() && inferredName ? { ...form, name: inferredName } : form;
        const result = await createSource.mutateAsync(
          buildMutationInputFromForm(sourceForm, {
            deriveNamespaceFromName: sourceForm.kind === "mcp",
          }),
        );

        if (sourceForm.kind === "mcp" && sourceForm.authType === "oauth2" && result?.id) {
          const redirectUrl = `${window.location.origin}/toolbox/sources/${result.id}`;
          const oauthResult = await startOAuth.mutateAsync({
            workspaceMcpServerId: result.id,
            redirectUrl,
          });
          window.location.assign(oauthResult.authUrl);
          return;
        }

        if (sourceForm.secret.trim() && result?.id) {
          await setCredential.mutateAsync({
            workspaceMcpServerId: result.id,
            secret: sourceForm.secret.trim(),
            displayName: sourceForm.displayName.trim(),
          });
        }

        toast.success("Source added.");
        router.push(`/toolbox/sources/${result.id}`);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to connect source.");
      }
    },
    [createSource, form, inferredName, isMcpCreate, router, setCredential, startOAuth],
  );

  if (listLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!isWorkspaceAdmin) {
    return (
      <div className="py-24 text-center">
        <p className="text-muted-foreground text-sm">
          You need workspace admin access to add sources.
        </p>
        <AppLink href="/toolbox" className="text-brand mt-4 inline-block text-sm hover:underline">
          Back to Toolbox
        </AppLink>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <AppLink
        href="/toolbox"
        className="text-muted-foreground hover:text-foreground mb-6 inline-flex items-center gap-1.5 text-sm transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Toolbox
      </AppLink>

      <h1 className="mb-6 text-xl font-semibold">Add MCP Server</h1>

      <form onSubmit={handleSubmit} className="bg-card rounded-xl border p-6 shadow-sm">
        {isMcpCreate ? (
          <div className="max-w-2xl space-y-5">
            {form.endpoint.trim() ? (
              <div className="bg-muted/25 flex items-center gap-3 rounded-xl border px-3 py-3">
                <WorkspaceMcpServerLogo
                  kind="mcp"
                  endpoint={form.endpoint}
                  className="h-10 w-10 shrink-0"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{effectiveMcpName || "MCP Server"}</p>
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <label htmlFor="new-source-endpoint" className="text-sm font-medium">
                Endpoint URL
              </label>
              <Input
                id="new-source-endpoint"
                value={form.endpoint}
                onChange={handleEndpointChange}
                placeholder="https://example.com/mcp"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            {form.endpoint.trim() ? (
              <div className="space-y-2">
                <label htmlFor="new-source-name" className="text-sm font-medium">
                  Server name
                </label>
                <Input
                  id="new-source-name"
                  value={form.name}
                  onChange={handleNameChange}
                  placeholder="Linear, Salesforce, Notion..."
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-8 flex justify-end gap-3">
          <Button type="button" variant="ghost" asChild>
            <AppLink href="/toolbox">Cancel</AppLink>
          </Button>
          <Button
            type="submit"
            disabled={
              createSource.isPending ||
              startOAuth.isPending ||
              (isMcpCreate && (!effectiveMcpName || !form.endpoint.trim()))
            }
          >
            {createSource.isPending || startOAuth.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Connect
          </Button>
        </div>
      </form>
    </div>
  );
}
