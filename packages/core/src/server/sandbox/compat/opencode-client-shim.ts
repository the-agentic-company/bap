import type { OpencodeClient } from "@opencode-ai/sdk/v2/client";
import type { RuntimeHarnessClient } from "../core/types";
import { mapRuntimeEventStream } from "../adapters/opencode-event-adapter";

export function createRuntimeHarnessClientFromOpencodeClient(
  client: OpencodeClient,
): RuntimeHarnessClient {
  return {
    subscribe: async (params, options) => {
      const result = await client.event.subscribe(params ?? {}, options);
      return { stream: mapRuntimeEventStream(result.stream) };
    },
    prompt: async (input) => {
      const result = await client.session.prompt({
        sessionID: input.sessionID,
        parts: input.parts as never,
        ...(input.agent ? { agent: input.agent } : {}),
        ...(input.system ? { system: input.system } : {}),
        ...(input.tools ? { tools: input.tools } : {}),
        ...(input.model ? { model: input.model as never } : {}),
        ...(input.noReply ? { noReply: input.noReply } : {}),
      });
      if (!result) {
        return { data: null, error: null };
      }
      return { data: result.data ?? null, error: result.error ?? null };
    },
    abort: async ({ sessionID }) => {
      const result = await client.session.abort({ sessionID });
      return { data: result.data, error: result.error };
    },
    messages: async ({ sessionID, limit }) => {
      if (!client.session.messages) {
        return { data: [], error: null };
      }
      const result = await client.session.messages({
        sessionID,
        ...(typeof limit === "number" ? { limit } : {}),
      });
      return { data: result.data, error: result.error };
    },
    status: async () => {
      if (!client.session.status) {
        return { data: null, error: null };
      }
      const result = await client.session.status({});
      return { data: result.data, error: result.error };
    },
    getSession: async ({ sessionID }) => {
      const result = await client.session.get({ sessionID });
      return { data: result.data, error: result.error };
    },
    createSession: async ({ title }) => {
      const result = await client.session.create({ title });
      if (result.error || !result.data) {
        return { data: null, error: result.error ?? { message: "missing_data" } };
      }
      return { data: { id: result.data.id, title: result.data.title }, error: null };
    },
    updatePart: async ({ sessionID, messageID, partID, part }) => {
      const result = await client.part.update({
        sessionID,
        messageID,
        partID,
        part: part as never,
      });
      return { data: result.data ?? null, error: result.error ?? null };
    },
    replyPermission: async ({ requestID, reply }) => {
      await client.permission.reply({ requestID, reply });
    },
    replyQuestion: async ({ requestID, answers }) => {
      await client.question.reply({ requestID, answers });
    },
    rejectQuestion: async ({ requestID }) => {
      await client.question.reject({ requestID });
    },
  };
}
