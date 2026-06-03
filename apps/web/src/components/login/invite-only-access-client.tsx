"use client";

import { Link } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type RequestState = "idle" | "submitting" | "sent" | "already-approved" | "error";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function InviteOnlyAccessClient({
  initialEmail,
  initialSource,
}: {
  initialEmail?: string;
  initialSource?: string;
}) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [status, setStatus] = useState<RequestState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => normalizeEmail(email).length > 0 && status !== "submitting",
    [email, status],
  );

  const handleRequestAccess = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setStatus("submitting");
      setMessage(null);

      const normalizedEmail = normalizeEmail(email);

      try {
        const response = await fetch("/api/invite-only/request-access", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            email: normalizedEmail,
            source: initialSource ?? "invite-only-page",
          }),
        });

        const result = (await response.json()) as
          | { ok: true; alreadyApproved: boolean }
          | { error?: string };

        if (!response.ok) {
          setStatus("error");
          setMessage(
            ("error" in result ? result.error : undefined) ??
              "We couldn't send your request. Try again.",
          );
          return;
        }

        if ("alreadyApproved" in result && result.alreadyApproved) {
          setStatus("already-approved");
          setMessage("This email is already approved.");
          return;
        }

        setStatus("sent");
        setMessage("Request sent. We'll review it shortly.");
      } catch {
        setStatus("error");
        setMessage("We couldn't send your request. Try again.");
      }
    },
    [email, initialSource],
  );

  const handleEmailChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(event.target.value);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="bg-card mx-auto flex w-full max-w-lg flex-col gap-6 rounded-2xl border p-6 shadow-sm">
        <div className="space-y-1 text-center">
          <p className="text-muted-foreground text-xs font-medium tracking-[0.14em] uppercase">
            CmdClaw
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Request access</h1>
          <p className="text-muted-foreground text-sm">
            CmdClaw is invite-only. Enter your email to request access.
          </p>
        </div>

        <form onSubmit={handleRequestAccess} className="space-y-3">
          <label className="text-muted-foreground text-sm font-medium" htmlFor="invite-email">
            Email
          </label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={handleEmailChange}
            placeholder="you@example.com"
            autoComplete="email"
            required
            aria-invalid={status === "error"}
          />
          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {status === "submitting"
              ? "Sending..."
              : status === "sent"
                ? "Request sent"
                : "Request access"}
          </Button>
        </form>

        {message ? (
          <div
            className={
              status === "error"
                ? "border-destructive/30 bg-destructive/10 text-destructive rounded-xl border p-3 text-sm"
                : status === "already-approved"
                  ? "rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground rounded-xl border p-3 text-sm"
            }
          >
            {message}
          </div>
        ) : null}

        <div className="flex items-center justify-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">Back to login</Link>
          </Button>
          {status === "already-approved" ? (
            <Button asChild size="sm">
              <Link to="/login">Log in</Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
