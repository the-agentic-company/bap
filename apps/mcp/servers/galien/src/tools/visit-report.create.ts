import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { requestGalien } from "../lib/galien-client";
import { getManagedGalienToolCredentials } from "../lib/galien-auth";
import { galienIsoDateTimeSchema, validateGalienToolParams } from "../lib/tool-helpers";

export const CMDCLAW_VISIT_REPORT_COMMENT_MARKER = "(made by CmdClaw)";

export const schema = {
  clientId: z.number().int().optional(),
  contactPersonId: z.number().int().optional(),
  contactOutcomeId: z.number().int().optional(),
  visitDate: galienIsoDateTimeSchema
    .describe("Visit date. Use ISO 8601 UTC with milliseconds, for example 2026-04-28T10:00:00.000Z.")
    .optional(),
  duration: z.number().int().optional(),
  contactTypeId: z.number().int().optional(),
  numberOfPersons: z.number().int().optional(),
  training1: z.number().int().optional(),
  training2: z.number().int().optional(),
  otherTraining: z.string().optional(),
  otherTrainingComment: z.string().optional(),
  comment: z.string().optional(),
  qualification1: z.number().int().optional(),
  qualification2: z.number().int().optional(),
  retrocession: z.boolean().optional(),
  promotion: z.boolean().optional(),
  promotionMonth: z.string().optional(),
  previousSellOut: z.union([z.boolean(), z.number()]).optional(),
  currentSellOut: z.union([z.boolean(), z.number()]).optional(),
  plvOptions: z
    .array(
      z.object({
        plvLabel: z.string().optional(),
        optionsIds: z.array(z.number().int()).optional(),
      }),
    )
    .optional(),
};

export const metadata: ToolMetadata = {
  name: "visit-report.create",
  description: "Create a Galien visit report with POST /api/v1/visit-reports",
  annotations: {
    title: "Create visit report",
  },
};

export function addCmdClawCommentMarker(comment?: string) {
  const existingComment = comment ?? "";
  const trimmedComment = existingComment.trim();

  if (!trimmedComment) {
    return CMDCLAW_VISIT_REPORT_COMMENT_MARKER;
  }

  if (existingComment.includes(CMDCLAW_VISIT_REPORT_COMMENT_MARKER)) {
    return existingComment;
  }

  return `${existingComment.trimEnd()}\n\n${CMDCLAW_VISIT_REPORT_COMMENT_MARKER}`;
}

export default async function createVisitReport(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  const validatedParams = validateGalienToolParams(schema, params);
  const credentials = await getManagedGalienToolCredentials(extra);
  const result = await requestGalien({
    method: "POST",
    path: "/api/v1/visit-reports",
    body: {
      ...validatedParams,
      comment: addCmdClawCommentMarker(validatedParams.comment),
    },
  }, credentials);
  return toMcpToolResult(result);
}
