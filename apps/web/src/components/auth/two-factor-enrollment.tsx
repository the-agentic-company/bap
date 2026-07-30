import { Check, Copy, Loader2, ShieldCheck } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

type EnrollmentData = {
  totpURI: string;
  backupCodes: string[];
};

export function TwoFactorEnrollment({
  initiallyEnabled,
  required = false,
  onComplete,
}: {
  initiallyEnabled: boolean;
  required?: boolean;
  onComplete?: () => void;
}) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [enrollment, setEnrollment] = useState<EnrollmentData | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const secret = useMemo(() => {
    if (!enrollment?.totpURI) {
      return null;
    }
    try {
      return new URL(enrollment.totpURI).searchParams.get("secret");
    } catch {
      return null;
    }
  }, [enrollment]);

  const startEnrollment = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setBusy(true);
      setError(null);

      const result = await authClient.twoFactor.enable({
        password,
        issuer: "Bap",
      });
      setBusy(false);

      if (result.error || !result.data) {
        setError(result.error?.message ?? "Unable to start two-factor setup.");
        return;
      }

      setEnrollment({
        totpURI: result.data.totpURI,
        backupCodes: result.data.backupCodes,
      });
      setPassword("");
    },
    [password],
  );

  const verifyEnrollment = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setBusy(true);
      setError(null);

      const result = await authClient.twoFactor.verifyTotp({
        code: verificationCode.trim(),
        trustDevice: false,
      });
      setBusy(false);

      if (result.error) {
        setError("That authenticator code is invalid or expired.");
        return;
      }

      setBackupCodes(enrollment?.backupCodes ?? []);
      setEnrollment(null);
      setVerificationCode("");
      setEnabled(true);
      toast.success("Two-factor authentication enabled.");
      onComplete?.();
    },
    [enrollment?.backupCodes, onComplete, verificationCode],
  );

  const disableTwoFactor = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setBusy(true);
      setError(null);

      const result = await authClient.twoFactor.disable({ password });
      setBusy(false);

      if (result.error) {
        setError(result.error.message ?? "Unable to disable two-factor authentication.");
        return;
      }

      setEnabled(false);
      setPassword("");
      toast.success("Two-factor authentication disabled.");
      onComplete?.();
    },
    [onComplete, password],
  );

  const copyBackupCodes = useCallback(async () => {
    await navigator.clipboard.writeText(backupCodes.join("\n"));
    toast.success("Recovery codes copied.");
  }, [backupCodes]);

  const handlePasswordChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(event.target.value);
  }, []);

  const handleVerificationCodeChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setVerificationCode(event.target.value);
  }, []);

  if (backupCodes.length > 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="text-brand mt-0.5 h-5 w-5" />
          <div>
            <p className="text-sm font-medium">Save your recovery codes</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Store these one-time codes somewhere safe. They will not be shown again.
            </p>
          </div>
        </div>
        <div className="bg-muted grid grid-cols-2 gap-2 rounded-lg p-4 font-mono text-sm">
          {backupCodes.map((code) => (
            <span key={code}>{code}</span>
          ))}
        </div>
        <Button type="button" variant="outline" onClick={copyBackupCodes}>
          <Copy className="h-4 w-4" />
          Copy recovery codes
        </Button>
      </div>
    );
  }

  if (enabled) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Check className="text-emerald-600 h-4 w-4" />
          Two-factor authentication is enabled
        </div>
        {required ? (
          <p className="text-muted-foreground text-sm">
            A Workspace you belong to requires two-factor authentication, so it cannot be disabled.
          </p>
        ) : (
          <form onSubmit={disableTwoFactor} className="flex max-w-md gap-2">
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="Current password"
              aria-label="Current password"
              value={password}
              onChange={handlePasswordChange}
              required
            />
            <Button type="submit" variant="outline" disabled={!password || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Disable"}
            </Button>
          </form>
        )}
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
      </div>
    );
  }

  if (enrollment) {
    return (
      <div className="space-y-5">
        <div className="bg-white p-3 w-fit rounded-lg">
          <QRCode value={enrollment.totpURI} size={180} />
        </div>
        <div>
          <p className="text-sm font-medium">Scan with your authenticator app</p>
          {secret ? (
            <p className="text-muted-foreground mt-1 break-all font-mono text-xs">
              Manual key: {secret}
            </p>
          ) : null}
        </div>
        <form onSubmit={verifyEnrollment} className="flex max-w-md gap-2">
          <Input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6-digit code"
            aria-label="Authenticator code"
            value={verificationCode}
            onChange={handleVerificationCodeChange}
            required
            autoFocus
          />
          <Button type="submit" disabled={!verificationCode.trim() || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
          </Button>
        </form>
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Use an authenticator app to protect password sign-ins with a second factor.
      </p>
      <form onSubmit={startEnrollment} className="flex max-w-md gap-2">
        <Input
          type="password"
          autoComplete="current-password"
          placeholder="Current password"
          aria-label="Current password"
          value={password}
          onChange={handlePasswordChange}
          required
        />
        <Button type="submit" disabled={!password || busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set up"}
        </Button>
      </form>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
