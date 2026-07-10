import type React from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

type InvitationStatus = "loading" | "unauthenticated" | "ready" | "accepted" | "rejected" | "error";
type InvitationAction = "accept" | "reject";

type WorkspaceInvitation = {
  id: string;
  email: string;
  role: string;
  organizationName: string;
  inviterEmail: string;
};

type AuthOrganizationClient = {
  getInvitation(input: { query: { id: string } }): Promise<{
    data?: WorkspaceInvitation | null;
    error?: { message?: string } | null;
  }>;
  acceptInvitation(input: { invitationId: string }): Promise<{
    data?: unknown;
    error?: { message?: string } | null;
  }>;
  rejectInvitation(input: { invitationId: string }): Promise<{
    data?: unknown;
    error?: { message?: string } | null;
  }>;
};

function getOrganizationClient(): AuthOrganizationClient {
  return authClient.organization as AuthOrganizationClient;
}

export const Route = createFileRoute("/_auth/workspace-invitations/$invitationId")({
  component: WorkspaceInvitationPage,
  head: () => ({
    meta: [{ title: "Workspace invitation - Bap" }],
  }),
});

function WorkspaceInvitationPage() {
  const params = Route.useParams();
  const navigate = useNavigate();
  const navigateToHref = useCallback((href: string) => navigate({ href }), [navigate]);

  return <WorkspaceInvitationView invitationId={params.invitationId} navigate={navigateToHref} />;
}

function getActionErrorMessage(action: InvitationAction, message: string | undefined): string {
  if (message) {
    return message;
  }

  return action === "accept"
    ? "We couldn't accept this Workspace Invitation. Try again."
    : "We couldn't reject this Workspace Invitation. Try again.";
}

function InvitationCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-card mx-auto flex w-full max-w-lg flex-col gap-6 rounded-2xl border p-6 shadow-sm">
      <div className="space-y-1 text-center">
        <p className="text-muted-foreground text-xs font-medium tracking-[0.14em] uppercase">Bap</p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {children}
    </div>
  );
}

export function WorkspaceInvitationView({
  invitationId,
  navigate,
}: {
  invitationId: string;
  navigate: (href: string) => void;
}) {
  const [status, setStatus] = useState<InvitationStatus>("loading");
  const [pendingAction, setPendingAction] = useState<InvitationAction | null>(null);
  const [invitation, setInvitation] = useState<WorkspaceInvitation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadInvitation() {
      setStatus("loading");
      setError(null);

      const sessionResult = await authClient.getSession().catch(() => null);
      if (!isMounted) {
        return;
      }

      if (!sessionResult?.data?.user?.id) {
        setStatus("unauthenticated");
        return;
      }

      const { data, error: invitationError } = await getOrganizationClient().getInvitation({
        query: { id: invitationId },
      });

      if (!isMounted) {
        return;
      }

      if (invitationError || !data) {
        setStatus("error");
        setError(invitationError?.message ?? "This Workspace Invitation is unavailable.");
        return;
      }

      setInvitation(data);
      setStatus("ready");
    }

    void loadInvitation();

    return () => {
      isMounted = false;
    };
  }, [invitationId]);

  const handleLogin = useCallback(() => {
    navigate(`/login?callbackUrl=${encodeURIComponent(`/workspace-invitations/${invitationId}`)}`);
  }, [invitationId, navigate]);

  const handleOpenWorkspace = useCallback(() => {
    navigate("/chat");
  }, [navigate]);

  const runInvitationAction = useCallback(
    async (action: InvitationAction) => {
      setPendingAction(action);
      setError(null);

      const { error: actionError } =
        action === "accept"
          ? await getOrganizationClient().acceptInvitation({ invitationId })
          : await getOrganizationClient().rejectInvitation({ invitationId });

      setPendingAction(null);

      if (actionError) {
        setStatus("error");
        setError(getActionErrorMessage(action, actionError.message));
        return;
      }

      setStatus(action === "accept" ? "accepted" : "rejected");
    },
    [invitationId],
  );

  const handleAccept = useCallback(() => {
    void runInvitationAction("accept");
  }, [runInvitationAction]);

  const handleReject = useCallback(() => {
    void runInvitationAction("reject");
  }, [runInvitationAction]);

  return (
    <div className="bg-background flex min-h-screen items-center justify-center px-4 py-12">
      <InvitationCard
        title={
          status === "accepted"
            ? "Workspace joined"
            : status === "rejected"
              ? "Invitation rejected"
              : "Workspace invitation"
        }
        description={
          status === "accepted"
            ? "You can now use this Workspace in Bap."
            : status === "rejected"
              ? "This invitation will no longer grant Workspace access."
              : "Review the invitation before joining."
        }
      >
        {status === "loading" ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Loading invitation...
          </div>
        ) : null}

        {status === "unauthenticated" ? (
          <div className="space-y-4">
            <p className="text-muted-foreground text-center text-sm">
              Sign in with the invited email address to accept or reject this Workspace Invitation.
            </p>
            <Button type="button" className="w-full" onClick={handleLogin}>
              Sign in
            </Button>
          </div>
        ) : null}

        {status === "ready" && invitation ? (
          <div className="space-y-4">
            <div className="rounded-xl border p-4 text-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-muted-foreground text-xs uppercase">Workspace</p>
                  <p className="font-medium">{invitation.organizationName}</p>
                </div>
                <div className="text-right">
                  <p className="text-muted-foreground text-xs uppercase">Role</p>
                  <p className="font-medium capitalize">{invitation.role}</p>
                </div>
              </div>
              <p className="text-muted-foreground mt-4">
                Invited by {invitation.inviterEmail} for {invitation.email}.
              </p>
            </div>
            {error ? (
              <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border p-3 text-sm">
                {error}
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleReject}
                disabled={Boolean(pendingAction)}
              >
                {pendingAction === "reject" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <X className="size-4" />
                )}
                Reject
              </Button>
              <Button type="button" onClick={handleAccept} disabled={Boolean(pendingAction)}>
                {pendingAction === "accept" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Check className="size-4" />
                )}
                Accept
              </Button>
            </div>
          </div>
        ) : null}

        {status === "accepted" ? (
          <Button type="button" className="w-full" onClick={handleOpenWorkspace}>
            Open Bap
          </Button>
        ) : null}

        {status === "rejected" ? (
          <Button type="button" variant="outline" className="w-full" onClick={handleLogin}>
            Back to login
          </Button>
        ) : null}

        {status === "error" ? (
          <div className="space-y-4">
            <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border p-3 text-sm">
              {error ?? "This Workspace Invitation is unavailable."}
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={handleLogin}>
              Sign in again
            </Button>
          </div>
        ) : null}
      </InvitationCard>
    </div>
  );
}
