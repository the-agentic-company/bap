import { useEffect } from "react";
import { client } from "@/orpc/client";

const ACTIVITY_WRITE_INTERVAL_MS = 60_000;

/** Records deliberate browser use without allowing background API polling to extend idle time. */
export function SessionActivityTracker() {
  useEffect(() => {
    let lastSentAt = 0;
    let trailingTimer: number | null = null;

    const sendActivity = () => {
      lastSentAt = Date.now();
      void client.session.recordActivity().catch(() => {
        // Session validation and redirects are handled by the existing auth guard.
      });
    };

    const recordActivity = () => {
      const remaining = ACTIVITY_WRITE_INTERVAL_MS - (Date.now() - lastSentAt);
      if (remaining <= 0) {
        if (trailingTimer !== null) {
          window.clearTimeout(trailingTimer);
          trailingTimer = null;
        }
        sendActivity();
        return;
      }

      if (trailingTimer === null) {
        trailingTimer = window.setTimeout(() => {
          trailingTimer = null;
          sendActivity();
        }, remaining);
      }
    };

    window.addEventListener("pointerdown", recordActivity, { passive: true });
    window.addEventListener("keydown", recordActivity);
    window.addEventListener("wheel", recordActivity, { passive: true });

    return () => {
      if (trailingTimer !== null) {
        window.clearTimeout(trailingTimer);
      }
      window.removeEventListener("pointerdown", recordActivity);
      window.removeEventListener("keydown", recordActivity);
      window.removeEventListener("wheel", recordActivity);
    };
  }, []);

  return null;
}
