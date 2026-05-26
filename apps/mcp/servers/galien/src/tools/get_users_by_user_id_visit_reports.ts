import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import {
  galienIsoDateTimeSchema,
  galienQueryValueSchema,
  requestCurrentGalienUserGet,
  validateGalienToolParams,
} from "../lib/tool-helpers";

export const schema = {
  "startDate": galienIsoDateTimeSchema.describe("Visit report range start. Use ISO 8601 UTC with milliseconds, for example 2026-04-28T00:00:00.000Z."),
  "endDate": galienIsoDateTimeSchema.describe("Visit report range end. Use ISO 8601 UTC with milliseconds, for example 2026-05-04T23:59:59.999Z."),
  "size": galienQueryValueSchema.optional().describe("Number of items to return"),
  "offset": galienQueryValueSchema.optional().describe("Offset from which the list of items should be returned"),
};

export const metadata: ToolMetadata = {
  name: "get_my_visit_reports",
  description:
    "Get the authenticated Galien user's visit reports / comptes rendus de visite. Use this for 'mes rapports de visite' or current-user visit reports. The userId is read from the login JWT.",
  annotations: {
    title: "Get My Visit Reports",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function getMyVisitReports(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  const validatedParams = validateGalienToolParams(schema, params);
  const result = await requestCurrentGalienUserGet("/api/v1/users/{userId}/visit-reports", validatedParams as Record<string, string | number | boolean | Array<string | number | boolean> | undefined>, extra);
  return toMcpToolResult(result);
}
