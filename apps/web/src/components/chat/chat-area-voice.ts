import { useCallback, useEffect, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { blobToBase64, useVoiceRecording } from "@/hooks/use-voice-recording";
import { useTranscribe } from "@/orpc/hooks/voice";
import type { InputPrefillRequest } from "./chat-area-content";

export function useChatAreaVoice({
  isStreaming,
  setInputPrefillRequest,
}: {
  isStreaming: boolean;
  setInputPrefillRequest: (request: InputPrefillRequest) => void;
}) {
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const isRecordingRef = useRef(false);
  // Tracks whether the current recording was started via the mod+k hold-to-talk shortcut.
  // Only keyboard-initiated recordings are stopped on key release; a click-to-toggle
  // recording (mic button) must survive unrelated key presses.
  const keyboardInitiatedRef = useRef(false);
  const { isRecording, error: voiceError, startRecording, stopRecording } = useVoiceRecording();
  const { mutateAsync: transcribe } = useTranscribe();

  const stopRecordingAndTranscribe = useCallback(async () => {
    if (!isRecordingRef.current) {
      return;
    }
    isRecordingRef.current = false;
    keyboardInitiatedRef.current = false;

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
    isProcessingVoice,
    isRecording,
    stopRecordingAndTranscribe,
    voiceError,
  };
}
