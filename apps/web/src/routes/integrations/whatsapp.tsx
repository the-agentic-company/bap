"use client";

import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type WhatsAppStatus = {
  status: "disconnected" | "connecting" | "connected";
  lastQr: string | null;
  lastError: string | null;
};

export const Route = createFileRoute("/integrations/whatsapp")({
  head: () => ({ meta: [{ title: "WhatsApp - CmdClaw" }] }),
  component: WhatsAppIntegrationPage,
});

function WhatsAppIntegrationPage() {
  const [waStatus, setWaStatus] = useState<WhatsAppStatus | null>(null);
  const [waQrDataUrl, setWaQrDataUrl] = useState<string | null>(null);
  const [waLoading, setWaLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [linkExpiresAt, setLinkExpiresAt] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);

  useEffect(() => {
    let active = true;

    const loadStatus = async () => {
      setWaLoading(true);
      try {
        const res = await fetch("/api/whatsapp/status");
        if (!res.ok) {
          if (res.status === 403 && active) {
            setForbidden(true);
            setWaStatus(null);
          }
          return;
        }
        const data = (await res.json()) as WhatsAppStatus;
        if (!active) {
          return;
        }
        setForbidden(false);
        setWaStatus(data);
      } catch (err) {
        console.error("Failed to load WhatsApp status:", err);
      } finally {
        if (active) {
          setWaLoading(false);
        }
      }
    };

    loadStatus();
    const interval = setInterval(loadStatus, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!waStatus?.lastQr) {
      setWaQrDataUrl(null);
      return;
    }
    QRCode.toDataURL(waStatus.lastQr, { margin: 1, width: 240 })
      .then(setWaQrDataUrl)
      .catch((err) => {
        console.error("Failed to render WhatsApp QR:", err);
        setWaQrDataUrl(null);
      });
  }, [waStatus?.lastQr]);

  const handleReconnect = useCallback(async () => {
    setWaLoading(true);
    try {
      const res = await fetch("/api/whatsapp/start", { method: "POST" });
      if (!res.ok) {
        if (res.status === 403) {
          setForbidden(true);
          toast.error("Only admins can pair the WhatsApp bridge.");
          return;
        }
        throw new Error(await res.text());
      }
      const data = (await res.json()) as WhatsAppStatus;
      setWaStatus(data);
    } catch (err) {
      console.error("Failed to reconnect WhatsApp:", err);
      toast.error("Failed to start WhatsApp pairing.");
    } finally {
      setWaLoading(false);
    }
  }, []);

  const handleGenerateLinkCode = useCallback(async () => {
    setLinkLoading(true);
    try {
      const res = await fetch("/api/whatsapp/link-code", { method: "POST" });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = (await res.json()) as { code: string; expiresAt: string };
      setLinkCode(data.code);
      setLinkExpiresAt(data.expiresAt);
      toast.success("WhatsApp link code generated.");
    } catch (err) {
      console.error("Failed to generate link code:", err);
      toast.error("Failed to generate link code.");
    } finally {
      setLinkLoading(false);
    }
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-semibold">WhatsApp</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Pair WhatsApp with a QR code, then link your own number with a code.
        </p>
      </div>

      <div className="space-y-6">
        <div className="rounded-lg border p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold">Bridge Pairing</h3>
              <p className="text-muted-foreground text-sm">
                Connect the app bridge to a WhatsApp account by scanning the QR code.
              </p>
            </div>
            <Button onClick={handleReconnect} disabled={waLoading || forbidden}>
              {waLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect WhatsApp"
              )}
            </Button>
          </div>

          <div className="bg-muted/20 mt-4 rounded-lg border p-4">
            <div className="text-muted-foreground text-sm">
              Status:{" "}
              <span className="text-foreground font-medium">{waStatus?.status ?? "unknown"}</span>
            </div>
            {forbidden && (
              <p className="text-muted-foreground mt-2 text-sm">
                Only admins can pair the shared WhatsApp bridge.
              </p>
            )}
            {waStatus?.lastError && (
              <div className="text-destructive mt-1 text-sm">{waStatus.lastError}</div>
            )}
            {waQrDataUrl ? (
              <div className="mt-4 flex flex-col items-start gap-2">
                <img
                  src={waQrDataUrl}
                  alt="WhatsApp QR code"
                  width={240}
                  height={240}
                  loading="lazy"
                  decoding="async"
                  className="h-60 w-60 rounded-md border bg-white p-2"
                />
                <p className="text-muted-foreground text-xs">
                  Scan this in WhatsApp: Settings {"->"} Linked Devices {"->"} Link a Device.
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground mt-4 text-xs">
                QR code will appear here when pairing is available.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-lg border p-6">
          <h3 className="text-lg font-semibold">User Linking Code</h3>
          <p className="text-muted-foreground mt-1 text-sm">
            Generate your code and send it from your WhatsApp number to complete account linking.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button onClick={handleGenerateLinkCode} disabled={linkLoading}>
              {linkLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                "Generate link code"
              )}
            </Button>
            {linkCode && (
              <div className="bg-muted/40 rounded-md border px-4 py-2 text-sm">
                <div className="font-medium">Code: {linkCode}</div>
                {linkExpiresAt && (
                  <div className="text-muted-foreground text-xs">
                    Expires at {new Date(linkExpiresAt).toLocaleTimeString()}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
