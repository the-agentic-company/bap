import { useCallback, useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { blobToBase64, useVoiceRecording } from "@/hooks/use-voice-recording";
import { useTranscribe } from "@/orpc/hooks/voice";
import type { InputPrefillRequest } from "./chat-area-content";

// How often to refresh the interim transcript while recording.
const INTERIM_POLL_INTERVAL_MS = 1500;

export function useChatAreaVoice({
  isStreaming,
  setInputPrefillRequest,
}: {
  isStreaming: boolean;
  setInputPrefillRequest: (request: InputPrefillRequest) => void;
}) {
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  // Best-effort live preview of the transcript while recording (see the polling
  // effect below). Empty when not recording or before the first partial result.
  const [interimTranscript, setInterimTranscript] = useState("");
  const isRecordingRef = useRef(false);
  // Guards against overlapping interim transcription requests.
  const interimInFlightRef = useRef(false);
  // Tracks whether the current recording was started via the mod+k hold-to-talk shortcut.
  // Only keyboard-initiated recordings are stopped on key release; a click-to-toggle
  // recording (mic button) must survive unrelated key presses.
  const keyboardInitiatedRef = useRef(false);
  const { isRecording, error: voiceError, startRecording, stopRecording, getPartialAudio } =
    useVoiceRecording();
  const { mutateAsync: transcribe } = useTranscribe();

  const stopRecordingAndTranscribe = useCallback(async () => {
    if (!isRecordingRef.current) {
      return;
    }
    isRecordingRef.current = false;
    keyboardInitiatedRef.current = false;
    setInterimTranscript("");

    const audioBlob = await stopRecording();
    if (!audioBlob || audioBlob.size === 0) {
      return;
    }

    setIsProcessingVoice(true);
    try {
      const base64Audio = await blobToBase64(audioBlob);
      const result = await transcribe({
        audio: base64Audio,
        mimeType: audioBlob.type || "audio/webm",
      });

      if (result.text && result.text.trim()) {
        setInputPrefillRequest({
          id: `voice-prefill-${Date.now()}`,
          text: result.text.trim(),
          mode: "append",
        });
      }
    } catch (err) {
      console.error("Transcription error:", err);
    } finally {
      setIsProcessingVoice(false);
    }
  }, [setInputPrefillRequest, stopRecording, transcribe]);

  const handleStartRecording = useCallback(
    (fromKeyboard = false) => {
      if (!isRecordingRef.current && !isStreaming && !isProcessingVoice) {
        isRecordingRef.current = true;
        keyboardInitiatedRef.current = fromKeyboard;
        startRecording();
      }
    },
    [isProcessingVoice, isStreaming, startRecording],
  );

  const handleHotkeyStartRecording = useCallback(
    () => handleStartRecording(true),
    [handleStartRecording],
  );

  useHotkeys(
    "mod+k",
    handleHotkeyStartRecording,
    {
      keydown: true,
      keyup: false,
      preventDefault: true,
      enableOnFormTags: true,
    },
    [handleHotkeyStartRecording],
  );

  // Pseudo real-time transcription: while recording, periodically re-transcribe
  // the audio captured so far and surface it as an interim preview. This reuses
  // the existing batch endpoint (no streaming infra); latency is one poll cycle.
  useEffect(() => {
    if (!isRecording) {
      setInterimTranscript("");
      return;
    }

    let cancelled = false;
    const intervalId = setInterval(() => {
      if (interimInFlightRef.current) {
        return;
      }
      const partial = getPartialAudio();
      if (!partial || partial.size === 0) {
        return;
      }
      interimInFlightRef.current = true;
      void (async () => {
        try {
          const base64Audio = await blobToBase64(partial);
          const result = await transcribe({
            audio: base64Audio,
            mimeType: partial.type || "audio/webm",
          });
          // Ignore results that land after recording stopped (the final
          // transcription owns the committed text at that point).
          if (!cancelled && isRecordingRef.current && result.text?.trim()) {
            setInterimTranscript(result.text.trim());
          }
        } catch {
          // Interim previews are best-effort; the final transcription is authoritative.
        } finally {
          interimInFlightRef.current = false;
        }
      })();
    }, INTERIM_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [isRecording, getPartialAudio, transcribe]);

  useEffect(() => {
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!isRecordingRef.current) {
        return;
      }

      const isHotkeyRelease =
        event.key === "k" ||
        event.key === "K" ||
        event.code === "KeyK" ||
        event.key === "Meta" ||
        event.key === "Control";

      if (isHotkeyRelease && keyboardInitiatedRef.current) {
        stopRecordingAndTranscribe();
      }
    };

    document.addEventListener("keyup", handleKeyUp);
    return () => document.removeEventListener("keyup", handleKeyUp);
  }, [stopRecordingAndTranscribe]);

  return {
    handleStartRecording,
    interimTranscript,
    isProcessingVoice,
    isRecording,
    stopRecordingAndTranscribe,
    voiceError,
  };
}
