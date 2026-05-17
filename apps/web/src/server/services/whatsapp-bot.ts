type WhatsAppStatus = "disconnected" | "connecting" | "connected";

type WhatsAppState = {
  status: WhatsAppStatus;
  lastQr: string | null;
  lastQrAt: Date | null;
  lastError: string | null;
};

const state: WhatsAppState = {
  status: "disconnected",
  lastQr: null,
  lastQrAt: null,
  lastError: null,
};

export function getWhatsAppStatus(): WhatsAppState {
  return { ...state };
}
