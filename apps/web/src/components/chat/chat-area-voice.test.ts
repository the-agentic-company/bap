// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isRecording: false,
  startRecording: vi.fn<() => Promise<void>>(),
  stopRecording: vi.fn<() => Promise<Blob | null>>(),
  getPartialAudio: vi.fn<() => Blob | null>(),
  transcribe:
    vi.fn<
      (input: { audio: string; mimeType: string; multilingual?: boolean }) => Promise<{
        text: string;
      }>
    >(),
  blobToBase64: vi.fn<(blob: Blob) => Promise<string>>(),
}));

vi.mock("@/hooks/use-voice-recording", () => ({
  useVoiceRecording: () => ({
    isRecording: mocks.isRecording,
    error: null,
    startRecording: mocks.startRecording,
    stopRecording: mocks.stopRecording,
    getPartialAudio: mocks.getPartialAudio,
  }),
  blobToBase64: mocks.blobToBase64,
}));

vi.mock("@/orpc/hooks/voice", () => ({
  useTranscribe: () => ({ mutateAsync: mocks.transcribe }),
}));

vi.mock("react-hotkeys-hook", () => ({ useHotkeys: () => {} }));

import { useChatAreaVoice } from "./chat-area-voice";

beforeEach(() => {
  vi.useFakeTimers();
  mocks.isRecording = false;
  mocks.startRecording.mockReset().mockResolvedValue(undefined);
  mocks.stopRecording.mockReset().mockResolvedValue(null);
  mocks.getPartialAudio.mockReset().mockReturnValue(null);
  mocks.transcribe.mockReset().mockResolvedValue({ text: "" });
  mocks.blobToBase64.mockReset().mockResolvedValue("base64-audio");
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useChatAreaVoice interim transcription", () => {
  it("surfaces a live interim transcript while recording", async () => {
    mocks.isRecording = true;
    mocks.getPartialAudio.mockReturnValue(new Blob(["audio"], { type: "audio/webm" }));
    mocks.transcribe.mockResolvedValue({ text: "hello there" });

    const { result } = renderHook(() =>
      useChatAreaVoice({ isStreaming: false, setInputPrefillRequest: vi.fn<() => void>() }),
    );

    // Arm the recording ref the way the mic button / hotkey would.
    act(() => {
      result.current.handleStartRecording();
    });
    expect(result.current.interimTranscript).toBe("");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });

    expect(mocks.transcribe).toHaveBeenCalledWith({
      audio: "base64-audio",
      mimeType: "audio/webm",
      multilingual: true,
    });
    expect(result.current.interimTranscript).toBe("hello there");
  });

  it("does not poll when there is no buffered audio yet", async () => {
    mocks.isRecording = true;
    mocks.getPartialAudio.mockReturnValue(null);

    const { result } = renderHook(() =>
      useChatAreaVoice({ isStreaming: false, setInputPrefillRequest: vi.fn<() => void>() }),
    );
    act(() => {
      result.current.handleStartRecording();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5200);
    });

    expect(mocks.transcribe).not.toHaveBeenCalled();
    expect(result.current.interimTranscript).toBe("");
  });

  it("clears the interim transcript once recording stops", async () => {
    mocks.isRecording = true;
    mocks.getPartialAudio.mockReturnValue(new Blob(["audio"], { type: "audio/webm" }));
    mocks.transcribe.mockResolvedValue({ text: "partial words" });

    const { result, rerender } = renderHook(() =>
      useChatAreaVoice({ isStreaming: false, setInputPrefillRequest: vi.fn<() => void>() }),
    );
    act(() => {
      result.current.handleStartRecording();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    expect(result.current.interimTranscript).toBe("partial words");

    // Recorder reports it has stopped -> the polling effect tears down and clears.
    mocks.isRecording = false;
    rerender();
    expect(result.current.interimTranscript).toBe("");
  });
});
