import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createActivationGate } from "./agentic-app-activation-gate";
import {
  type AgenticAppPromptRejectionReason,
  buildAgenticAppPromptResult,
  parseAgenticAppPromptMessage,
} from "./agentic-app-protocol";

// Programmatic focus (autofocus, scripted `.focus()`) fires synchronously around the
// iframe load; a genuine user focus-entry comes seconds later. Ignoring focus-entry
// engagement inside this grace window prevents a hostile Agentic-App from self-arming
// the gate on load.
const FOCUS_ENGAGEMENT_LOAD_GRACE_MS = 1000;

type AgenticAppPromptBridgeOptions = {
  outputFileId: string;
  onSendPrompt: (prompt: string) => Promise<unknown> | unknown;
};

export function useAgenticAppPromptBridge({
  outputFileId,
  onSendPrompt,
}: AgenticAppPromptBridgeOptions) {
  const posthog = usePostHog();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [gate] = useState(createActivationGate);
  const loadedAtRef = useRef<number | null>(null);
  const onSendPromptRef = useRef(onSendPrompt);
  onSendPromptRef.current = onSendPrompt;
  const posthogRef = useRef(posthog);
  posthogRef.current = posthog;

  const recordGesture = useCallback(() => {
    gate.recordGesture(Date.now());
  }, [gate]);

  const handleIframeLoad = useCallback(() => {
    loadedAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    // Clicks inside the sandboxed iframe never reach this document; focus moving into
    // the iframe fires a window blur with the iframe as the active element, which is
    // the parent-side evidence the user clicked into the app. The gate only arms when
    // a real gesture preceded this focus-entry (see createActivationGate).
    const handleWindowBlur = () => {
      const iframe = iframeRef.current;
      if (!iframe || document.activeElement !== iframe) {
        return;
      }
      const now = Date.now();
      const loadedAt = loadedAtRef.current;
      if (loadedAt !== null && now - loadedAt < FOCUS_ENGAGEMENT_LOAD_GRACE_MS) {
        return;
      }
      gate.recordFocusEntry(now);
    };
    window.addEventListener("blur", handleWindowBlur);
    return () => window.removeEventListener("blur", handleWindowBlur);
  }, [gate]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow || event.source !== iframe.contentWindow) {
        return;
      }

      const sourceWindow = event.source as Window;
      const postResult = (
        status: "sent" | "rejected",
        reason?: AgenticAppPromptRejectionReason,
      ) => {
        // The iframe may have detached (unmount, reload) before we reply; never let a
        // failed ack throw, and never ack a window that is no longer our iframe.
        if (iframeRef.current?.contentWindow !== sourceWindow) {
          return;
        }
        try {
          sourceWindow.postMessage(buildAgenticAppPromptResult(status, reason), "*");
        } catch {
          // window gone; nothing to do
        }
      };

      const capture = (status: "sent" | "rejected", reason?: AgenticAppPromptRejectionReason) => {
        posthogRef.current?.capture("agentic_app_prompt", {
          status,
          reason: reason ?? null,
          file_id: outputFileId,
        });
      };

      const parsed = parseAgenticAppPromptMessage(event.data);
      if (parsed.kind === "ignored") {
        return;
      }
      if (parsed.kind === "invalid") {
        capture("rejected", "invalid");
        postResult("rejected", "invalid");
        return;
      }

      const focused = document.activeElement === iframe;
      const verdict = gate.evaluate(Date.now(), focused);
      if (!verdict.allowed) {
        capture("rejected", verdict.reason);
        postResult("rejected", verdict.reason);
        return;
      }

      void Promise.resolve()
        .then(() => onSendPromptRef.current(parsed.prompt))
        .then((sendResult) => {
          if (sendResult) {
            gate.recordAccepted(Date.now());
            capture("sent");
            postResult("sent");
          } else {
            capture("rejected");
            postResult("rejected");
          }
        })
        .catch(() => {
          capture("rejected");
          postResult("rejected");
        });
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [gate, outputFileId]);

  return {
    iframeRef,
    handleIframeLoad,
    recordGesture,
  };
}
