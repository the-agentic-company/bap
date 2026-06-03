"use client";

/* oxlint-disable react-perf/jsx-no-new-object-as-prop -- motion props are declarative animation config */

import type React from "react";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { INVITE_ONLY_LOGIN_ERROR } from "@/lib/admin-emails";
import { authClient } from "@/lib/auth-client";

type Step = "initial" | "magic-link-sent" | "password" | "password-reset-sent";
type PasswordStepMode = "sign-in" | "create";
type PasswordEmailMode = "create" | "reset";
type InitialScreen = "login" | "getting-started";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="currentColor"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function LastUsedBadge({ variant = "brand" }: { variant?: "brand" | "inverted" }) {
  return (
    <span
      className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${
        variant === "inverted" ? "bg-white/12 text-white" : "bg-brand/10 text-brand"
      }`}
    >
      Last used
    </span>
  );
}

function MailCheckIcon() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-brand"
    >
      <path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
      <path d="m16 19 2 2 4-4" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-brand"
    >
      <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
      <path d="m21 2-9.6 9.6" />
      <circle cx="7.5" cy="15.5" r="5.5" />
    </svg>
  );
}

const stepVariants = {
  enter: { opacity: 0, y: 8, filter: "blur(4px)" },
  center: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -8, filter: "blur(4px)" },
};

const stepTransition = { duration: 0.25, ease: [0.4, 0, 0.2, 1] as const };

export function CloudLoginClient({
  callbackUrl,
  initialError,
  initialScreen = "login",
}: {
  callbackUrl: string;
  initialError?: string | null;
  initialScreen?: InitialScreen;
}) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<Step>("initial");
  const [passwordStepMode, setPasswordStepMode] = useState<PasswordStepMode | null>(null);
  const [passwordEmailMode, setPasswordEmailMode] = useState<PasswordEmailMode>("create");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [lastMethod, setLastMethod] = useState<string | null>(null);

  useEffect(() => {
    try {
      setLastMethod(authClient.getLastUsedLoginMethod());
    } catch {
      setLastMethod(null);
    }
  }, []);

  const title =
    step === "initial"
      ? initialScreen === "getting-started"
        ? "Getting started"
        : "Log in"
      : step === "password"
        ? passwordStepMode === "create"
          ? "Sign up"
          : "Log in"
        : step === "magic-link-sent"
          ? "Check your inbox"
          : passwordEmailMode === "create"
            ? "Create your password"
            : "Reset your password";

  const description =
    step === "initial"
      ? initialScreen === "getting-started"
        ? "Use an approved email to create an account."
        : "CmdClaw is invite-only. Use an approved email to sign in."
      : step === "password"
        ? passwordStepMode === "create"
          ? "Create a password to finish setting up your CmdClaw account."
          : "Enter your password to continue."
        : step === "magic-link-sent"
          ? "Open the link we sent to continue."
          : passwordEmailMode === "create"
            ? "We sent a password setup link to finish creating your account."
            : "We sent a password reset link so you can sign back in.";

  const requestMagicLink = useCallback(async () => {
    if (!email) {
      return;
    }
    setSubmitting(true);
    setError(null);

    const { error: signInError } = await authClient.signIn.magicLink({
      email: normalizeEmail(email),
      callbackURL: callbackUrl,
      newUserCallbackURL: callbackUrl,
      errorCallbackURL: "/login?error=magic-link",
    });

    if (signInError) {
      if (signInError.message === INVITE_ONLY_LOGIN_ERROR) {
        void navigate({
          to: "/invite-only",
          search: { source: "magic-link", email: normalizeEmail(email) },
        });
        return;
      }

      setSubmitting(false);
      setError(signInError.message || "Unable to send the magic link right now.");
      return;
    }

    setSubmitting(false);
    setStep("magic-link-sent");
  }, [callbackUrl, email, navigate]);

  const signInWithPassword = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSubmitting(true);
      setError(null);

      const { error: signInError } = await authClient.signIn.email({
        email: normalizeEmail(email),
        password,
        callbackURL: callbackUrl,
      });

      if (signInError) {
        if (signInError.message === INVITE_ONLY_LOGIN_ERROR) {
          void navigate({
            to: "/invite-only",
            search: { source: "password", email: normalizeEmail(email) },
          });
          return;
        }

        setSubmitting(false);
        setError("Invalid email or password.");
        return;
      }

      void navigate({ href: callbackUrl });
    },
    [callbackUrl, email, password, navigate],
  );

  const requestPasswordSetup = useCallback(
    async (mode: PasswordEmailMode) => {
      setSubmitting(true);
      setError(null);

      try {
        const response = await fetch("/api/auth/password/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: normalizeEmail(email),
            callbackUrl,
          }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { code?: string } | null;
          if (body?.code === INVITE_ONLY_LOGIN_ERROR) {
            void navigate({
              to: "/invite-only",
              search: { source: "password", email: normalizeEmail(email) },
            });
            return;
          }

          setSubmitting(false);
          setError("Unable to send a password email right now.");
          return;
        }

        setPasswordEmailMode(mode);
        setSubmitting(false);
        setStep("password-reset-sent");
      } catch {
        setSubmitting(false);
        setError("Unable to send a password email right now.");
      }
    },
    [callbackUrl, email, navigate],
  );

  const handleUsePassword = useCallback(async () => {
    if (!email) {
      return;
    }
    setError(null);
    setSubmitting(true);

    const normalizedEmail = normalizeEmail(email);
    try {
      const response = await fetch("/api/auth/check-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });

      const body = (await response.json().catch(() => null)) as {
        approved?: boolean;
        hasPassword?: boolean;
      } | null;
      setSubmitting(false);

      if (!response.ok) {
        setError("Unable to start password login right now.");
        return;
      }

      if (!body?.approved) {
        void navigate({
          to: "/invite-only",
          search: { source: "password", email: normalizedEmail },
        });
        return;
      }

      setPasswordStepMode(body.hasPassword ? "sign-in" : "create");
      setStep("password");
    } catch {
      setSubmitting(false);
      setError("Unable to start password login right now.");
    }
  }, [email, navigate]);

  const handleMagicLinkSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void requestMagicLink();
    },
    [requestMagicLink],
  );

  const handleGoogleSignIn = useCallback(async () => {
    await authClient.signIn.social({
      provider: "google",
      callbackURL: callbackUrl,
      errorCallbackURL: "/invite-only?source=social-google",
    });
  }, [callbackUrl]);

  const handleAppleSignIn = useCallback(async () => {
    await authClient.signIn.social({
      provider: "apple",
      callbackURL: callbackUrl,
      errorCallbackURL: "/invite-only?source=social-apple",
    });
  }, [callbackUrl]);

  const handleCreatePassword = useCallback(() => {
    void requestPasswordSetup("create");
  }, [requestPasswordSetup]);

  const handleForgotPassword = useCallback(() => {
    void requestPasswordSetup("reset");
  }, [requestPasswordSetup]);

  const handleBack = useCallback(() => {
    setStep("initial");
    setPassword("");
    setPasswordStepMode(null);
    setPasswordEmailMode("create");
    setError(null);
    setSubmitting(false);
  }, []);

  const handleEmailChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(event.target.value);
  }, []);

  const handlePasswordChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(event.target.value);
  }, []);

  return (
    <div className="bg-card mx-auto flex w-full max-w-md flex-col gap-6 rounded-2xl border p-8 shadow-sm">
      {/* Header */}
      <div className="space-y-1 text-center">
        <p className="text-muted-foreground text-xs font-medium tracking-[0.14em] uppercase">
          CmdClaw
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm text-balance">{description}</p>
      </div>

      {/* Social buttons — only visible on initial */}
      {step === "initial" && (
        <div className="flex flex-col gap-2">
          <Button type="button" variant="outline" className="w-full" onClick={handleGoogleSignIn}>
            <GoogleIcon />
            <span className="ml-2">Continue with Google</span>
            {lastMethod === "google" && <LastUsedBadge />}
          </Button>
          <Button type="button" variant="outline" className="w-full" onClick={handleAppleSignIn}>
            <AppleIcon />
            <span className="ml-2">Continue with Apple</span>
            {lastMethod === "apple" && <LastUsedBadge />}
          </Button>
        </div>
      )}

      {/* Divider — only on initial */}
      {step === "initial" && (
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card text-muted-foreground px-2">Or with email</span>
          </div>
        </div>
      )}

      {/* Step content with animated transitions */}
      <AnimatePresence mode="wait" initial={false}>
        {step === "initial" && (
          <motion.div
            key="initial"
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={stepTransition}
          >
            <form onSubmit={handleMagicLinkSubmit} className="space-y-3">
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                aria-label="Email"
                value={email}
                onChange={handleEmailChange}
                required
              />
              <div className="grid grid-cols-2 gap-2">
                <Button type="submit" className="w-full" disabled={!email || submitting}>
                  {submitting ? "Sending..." : "Magic link"}
                  {lastMethod === "email" && <LastUsedBadge variant="inverted" />}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={!email || submitting}
                  onClick={handleUsePassword}
                >
                  Password
                </Button>
              </div>
            </form>
          </motion.div>
        )}

        {step === "magic-link-sent" && (
          <motion.div
            key="magic-link-sent"
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={stepTransition}
          >
            <div className="flex flex-col items-center gap-4 py-2 text-center">
              <MailCheckIcon />
              <div className="space-y-1">
                <p className="text-sm font-medium">Check your inbox</p>
                <p className="text-muted-foreground text-sm">
                  We sent a magic link to{" "}
                  <span className="text-foreground font-medium">{email}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={handleBack}
                className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4 transition-colors"
              >
                Back to login
              </button>
            </div>
          </motion.div>
        )}

        {step === "password" && (
          <motion.div
            key="password"
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={stepTransition}
          >
            <div className="space-y-4">
              {/* Email display with change option */}
              <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                <span className="truncate text-sm">{email}</span>
                <button
                  type="button"
                  onClick={handleBack}
                  className="text-brand hover:text-brand-dark ml-2 shrink-0 text-sm font-medium"
                >
                  Change
                </button>
              </div>

              {passwordStepMode === "create" ? (
                <div className="space-y-3">
                  <Button
                    type="button"
                    className="w-full"
                    disabled={submitting}
                    onClick={handleCreatePassword}
                  >
                    {submitting ? "Sending..." : "Create password"}
                  </Button>
                </div>
              ) : (
                <>
                  <form onSubmit={signInWithPassword} className="space-y-3">
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      aria-label="Password"
                      value={password}
                      onChange={handlePasswordChange}
                      required
                      aria-invalid={!!error}
                      autoFocus
                    />
                    <Button type="submit" className="w-full" disabled={!password || submitting}>
                      {submitting ? "Signing in..." : "Sign in"}
                    </Button>
                  </form>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={submitting}
                      className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4 transition-colors disabled:opacity-50"
                    >
                      Forgot password?
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}

        {step === "password-reset-sent" && (
          <motion.div
            key="password-reset-sent"
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={stepTransition}
          >
            <div className="flex flex-col items-center gap-4 py-2 text-center">
              <KeyIcon />
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {passwordEmailMode === "create"
                    ? "Password setup link sent"
                    : "Password reset link sent"}
                </p>
                <p className="text-muted-foreground text-sm">
                  We sent a link to <span className="text-foreground font-medium">{email}</span>{" "}
                  {passwordEmailMode === "create"
                    ? "to create your password."
                    : "to reset your password."}
                </p>
              </div>
              <button
                type="button"
                onClick={handleBack}
                className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4 transition-colors"
              >
                Back to login
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error display */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="border-destructive/30 bg-destructive/10 text-destructive rounded-xl border p-3 text-sm"
        >
          {error}
        </motion.div>
      )}
    </div>
  );
}
