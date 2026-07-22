import { useMutation } from "@tanstack/react-query";
import { client } from "../client";

export function useTranscribe() {
  return useMutation({
    mutationFn: ({
      audio,
      mimeType,
      multilingual,
    }: {
      audio: string;
      mimeType: string;
      multilingual?: boolean;
    }) => client.voice.transcribe({ audio, mimeType, multilingual }),
  });
}
