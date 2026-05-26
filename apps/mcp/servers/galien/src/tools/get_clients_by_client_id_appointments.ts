import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import {
  galienDateOnlySchema,
  galienQueryValueSchema,
  requestGalienGet,
  validateGalienToolParams,
} from "../lib/tool-helpers";

export const schema = {
  "clientId": z.number().int().describe("Clients id"),
  "startDate": galienDateOnlySchema.describe("Client appointment range start. Use Galien date-only format YYYY-MM-DD, for example 2026-04-28."),
  "endDate": galienDateOnlySchema.describe("Client appointment range end. Use Galien date-only format YYYY-MM-DD, for example 2026-05-04."),
  "size": galienQueryValueSchema.optional().describe("Max Results"),
  "offset": galienQueryValueSchema.optional().describe("Offset"),
};

export const metadata: ToolMetadata = {
  name: "get_clients_by_client_id_appointments",
  description: "Get Clients Appointments (/api/v1/clients/{clientId}/appointments)",
  annotations: {
    title: "Get Clients Appointments",
    readOnlyHint: true,
    idempotentHint: true,
  },
};

export default async function getClientsByClientIdAppointments(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  const validatedParams = validateGalienToolParams(schema, params);
  const result = await requestGalienGet("/api/v1/clients/{clientId}/appointments", validatedParams as Record<string, string | number | boolean | Array<string | number | boolean> | undefined>, extra);
  return toMcpToolResult(result);
}
