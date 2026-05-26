import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import {
  galienIsoDateTimeSchema,
  galienQueryValueSchema,
  requestCurrentGalienUserGet,
  validateGalienToolParams,
} from "../lib/tool-helpers";

export const schema = {
  "startDate": galienIsoDateTimeSchema.describe("Visits coverage range start. Use ISO 8601 UTC with milliseconds, for example 2026-04-28T00:00:00.000Z."),
  "endDate": galienIsoDateTimeSchema.describe("Visits coverage range end. Use ISO 8601 UTC with milliseconds, for example 2026-05-04T23:59:59.999Z."),
  "groupIds": galienQueryValueSchema.optional().describe("Array of group type ids"),
  "recentColaborationCode": galienQueryValueSchema.optional().describe("Recent colaboration code"),
  "previousColaborationCode": galienQueryValueSchema.optional().describe("Previous colaboration code"),
  "targetTypeIds": galienQueryValueSchema.optional().describe("Array of target type ids"),
};

export const metadata: ToolMetadata = {
  name: "get_my_visits_coverage",
  description:
    "Get the authenticated Galien user's visits coverage / couverture de visites. Use this for current-user visit coverage. The userId is read from the login JWT.",
  annotations: {
    title: "Get My Visits Coverage",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function getMyVisitsCoverage(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  const validatedParams = validateGalienToolParams(schema, params);
  const result = await requestCurrentGalienUserGet("/api/v1/users/{userId}/visits-coverage", validatedParams as Record<string, string | number | boolean | Array<string | number | boolean> | undefined>, extra);
  return toMcpToolResult(result);
}
