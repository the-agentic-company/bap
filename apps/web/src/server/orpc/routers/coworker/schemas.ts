import { DEFAULT_CONNECTED_CHATGPT_MODEL } from "@bap/core/lib/chat-model-defaults";
import {
  COWORKER_AVAILABLE_INTEGRATION_TYPES,
  COWORKER_TOOL_ACCESS_MODES,
} from "@bap/core/lib/coworker-tool-policy";
import { parseModelReference } from "@bap/core/lib/model-reference";
import { z } from "zod";

export const integrationTypeSchema = z.enum([
  "google_gmail",
  "outlook",
  "outlook_calendar",
  "google_calendar",
  "google_docs",
  "google_sheets",
  "google_drive",
  "notion",
  "linear",
  "github",
  "airtable",
  "slack",
  "hubspot",
  "linkedin",
  "salesforce",
  "dynamics",
  "reddit",
  "twitter",
]);

export const DEFAULT_COWORKER_INTEGRATIONS = [...COWORKER_AVAILABLE_INTEGRATION_TYPES];

export const toolAccessModeSchema = z.enum(COWORKER_TOOL_ACCESS_MODES);

export const providerAuthSourceSchema = z.enum(["user", "shared"]);

export const modelReferenceSchema = z
  .string()
  .min(3)
  .refine((value) => {
    try {
      parseModelReference(value);
      return true;
    } catch {
      return false;
    }
  }, "Model must use provider/model format");

export const defaultModelReferenceSchema = modelReferenceSchema.default(
  DEFAULT_CONNECTED_CHATGPT_MODEL,
);

export const triggerTypeSchema = z.string().min(1).max(128);

export const userInputPromptSchema = z.string().max(1000).nullish();

export const scheduleSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interval"),
    intervalMinutes: z.number().min(60).max(10080),
  }),
  z.object({
    type: z.literal("daily"),
    time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    timezone: z.string().default("UTC"),
  }),
  z.object({
    type: z.literal("weekly"),
    time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    daysOfWeek: z.array(z.number().min(0).max(6)).min(1),
    timezone: z.string().default("UTC"),
  }),
  z.object({
    type: z.literal("monthly"),
    time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    dayOfMonth: z.number().min(1).max(31),
    timezone: z.string().default("UTC"),
  }),
]);
