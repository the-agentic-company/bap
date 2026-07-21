import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import {
  requestGalien,
  requestGalienForCurrentUserBodyField,
  type GalienCredentials,
} from "../lib/galien-client";
import { getManagedGalienToolCredentials } from "../lib/galien-auth";
import { galienIsoDateTimeSchema, validateGalienToolParams } from "../lib/tool-helpers";

export const BAP_APPOINTMENT_COMMENT_MARKER = "(made by Bap)";
export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 60;
export const APPOINTMENT_DUPLICATE_CHECK_PAGE_SIZE = 100;

export const schema = {
  clientId: z.number().int().describe("Galien client/pharmacy id, for example 14."),
  startDate: galienIsoDateTimeSchema.describe(
    "Appointment start as an ISO 8601 UTC datetime with milliseconds, for example 2026-07-29T09:00:00.000Z. Galien only accepts appointments whose start date is in the future.",
  ),
  endDate: galienIsoDateTimeSchema
    .optional()
    .describe(
      "Appointment end as an ISO 8601 UTC datetime with milliseconds. Defaults to startDate plus durationMinutes when omitted.",
    ),
  durationMinutes: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_APPOINTMENT_DURATION_MINUTES)
    .describe("Minutes used to derive endDate when endDate is omitted. Defaults to 60."),
  appointmentTypeId: z
    .number()
    .int()
    .optional()
    .describe(
      "Galien appointment type id, for example 2 for Visite Argumentée. Provide this or appointmentType.",
    ),
  appointmentType: z
    .string()
    .optional()
    .describe(
      'Appointment type label resolved against /api/v1/appointment-types, for example "Visite Argumentée", "Visite Sell-out" or "Visite Opportuniste". Provide this or appointmentTypeId.',
    ),
  contactPersonId: z.number().int().optional().describe("Galien contact person id for the client."),
  comment: z.string().optional().describe("Free-text appointment comment."),
};

export type AppointmentCreateParams = z.infer<z.ZodObject<typeof schema>>;

export const metadata: ToolMetadata = {
  name: "appointment.create",
  description:
    "Schedule a Galien appointment (a future visit) with POST /api/v1/appointments. Provide clientId, a future startDate (ISO 8601 UTC with milliseconds) and either appointmentTypeId or an appointmentType label (Visite Argumentée / Visite Sell-out / Visite Opportuniste). endDate defaults to startDate plus durationMinutes (60). An identical appointment (same start date and type for the client) is not recreated, because Galien appointments cannot be deleted through this MCP.",
  annotations: {
    title: "Create appointment",
  },
};

export type GalienAppointmentType = { id: number; eventType: string };
export type GalienClientAppointment = {
  id?: number;
  startDate?: string;
  eventType?: string;
  contactPerson?: string;
};

function extractDataArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }
  const data = (payload as { data?: unknown } | null | undefined)?.data;
  return Array.isArray(data) ? data : [];
}

export function extractAppointmentTypes(payload: unknown): GalienAppointmentType[] {
  return extractDataArray(payload)
    .map((item) => item as { id?: unknown; eventType?: unknown })
    .filter(
      (item): item is GalienAppointmentType =>
        typeof item.id === "number" && typeof item.eventType === "string",
    )
    .map((item) => ({ id: item.id, eventType: item.eventType }));
}

export function extractClientAppointments(payload: unknown): GalienClientAppointment[] {
  return extractDataArray(payload).map((item) => item as GalienClientAppointment);
}

export function extractClientAppointmentsTotal(payload: unknown): number | undefined {
  const total = (payload as { total?: unknown } | null | undefined)?.total;
  return typeof total === "number" && Number.isInteger(total) && total >= 0 ? total : undefined;
}

export function normalizeAppointmentTypeLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

export function resolveAppointmentType(
  params: Pick<AppointmentCreateParams, "appointmentTypeId" | "appointmentType">,
  types: GalienAppointmentType[],
): GalienAppointmentType {
  if (typeof params.appointmentTypeId === "number") {
    const byId = types.find((type) => type.id === params.appointmentTypeId);
    return byId ?? { id: params.appointmentTypeId, eventType: params.appointmentType ?? "" };
  }

  if (params.appointmentType) {
    const target = normalizeAppointmentTypeLabel(params.appointmentType);
    const match = types.find((type) => normalizeAppointmentTypeLabel(type.eventType) === target);
    if (match) {
      return match;
    }
    const available = types.map((type) => type.eventType).join(", ");
    throw new Error(
      `Unknown appointment type "${params.appointmentType}". Available Galien appointment types: ${available || "none"}.`,
    );
  }

  throw new Error("Provide either appointmentTypeId or appointmentType to create an appointment.");
}

export function addBapAppointmentCommentMarker(comment?: string): string {
  const existingComment = comment ?? "";
  if (!existingComment.trim()) {
    return BAP_APPOINTMENT_COMMENT_MARKER;
  }
  if (existingComment.includes(BAP_APPOINTMENT_COMMENT_MARKER)) {
    return existingComment;
  }
  return `${existingComment.trimEnd()}\n\n${BAP_APPOINTMENT_COMMENT_MARKER}`;
}

export function deriveAppointmentEndDate(
  startDate: string,
  endDate: string | undefined,
  durationMinutes: number,
): string {
  if (endDate) {
    return endDate;
  }
  const start = new Date(startDate);
  return new Date(start.getTime() + durationMinutes * 60_000).toISOString();
}

export function toGalienDateOnly(isoDateTime: string): string {
  return isoDateTime.slice(0, 10);
}

export function findDuplicateAppointment(
  existing: GalienClientAppointment[],
  startDate: string,
  eventType: string,
): GalienClientAppointment | undefined {
  const startMs = new Date(startDate).getTime();
  const normalizedType = normalizeAppointmentTypeLabel(eventType);
  return existing.find((appointment) => {
    if (!appointment.startDate) {
      return false;
    }
    const sameStart = new Date(appointment.startDate).getTime() === startMs;
    const sameType = appointment.eventType
      ? normalizeAppointmentTypeLabel(appointment.eventType) === normalizedType
      : false;
    return sameStart && sameType;
  });
}

export async function listAllClientAppointmentsForDay(
  clientId: number,
  day: string,
  credentials?: GalienCredentials,
): Promise<GalienClientAppointment[]> {
  const appointments: GalienClientAppointment[] = [];

  while (true) {
    const result = await requestGalien(
      {
        method: "GET",
        path: "/api/v1/clients/{clientId}/appointments",
        pathParams: { clientId },
        query: {
          startDate: day,
          endDate: day,
          size: APPOINTMENT_DUPLICATE_CHECK_PAGE_SIZE,
          offset: appointments.length,
        },
      },
      credentials,
    );
    const page = extractClientAppointments(result.data);
    const total = extractClientAppointmentsTotal(result.data);
    appointments.push(...page);

    if (page.length === 0 || (total !== undefined && appointments.length >= total)) {
      return appointments;
    }

    if (total === undefined && page.length < APPOINTMENT_DUPLICATE_CHECK_PAGE_SIZE) {
      return appointments;
    }
  }
}

export function buildAppointmentCreateBody(params: {
  clientId: number;
  startDate: string;
  endDate: string;
  appointmentTypeId: number;
  contactPersonId?: number;
  comment?: string;
}) {
  return {
    clientId: params.clientId,
    startDate: params.startDate,
    endDate: params.endDate,
    appointmentTypeId: params.appointmentTypeId,
    ...(typeof params.contactPersonId === "number"
      ? { contactPersonId: params.contactPersonId }
      : {}),
    comment: addBapAppointmentCommentMarker(params.comment),
  };
}

export default async function createAppointment(
  params: InferSchema<typeof schema>,
  extra?: ToolExtraArguments,
) {
  const validatedParams = validateGalienToolParams(schema, params);
  const credentials = await getManagedGalienToolCredentials(extra);

  // Resolve the appointment type, accepting either a Galien id or a human label
  // (Visite Argumentée / Visite Sell-out / Visite Opportuniste).
  const appointmentTypesResult = await requestGalien(
    { method: "GET", path: "/api/v1/appointment-types" },
    credentials,
  );
  const appointmentTypes = extractAppointmentTypes(appointmentTypesResult.data);
  const resolvedType = resolveAppointmentType(validatedParams, appointmentTypes);

  const endDate = deriveAppointmentEndDate(
    validatedParams.startDate,
    validatedParams.endDate,
    validatedParams.durationMinutes,
  );

  // Galien exposes no appointment deletion through this MCP, so guard against
  // duplicate appointments if the same report is sent more than once.
  const day = toGalienDateOnly(validatedParams.startDate);
  const existingAppointments = await listAllClientAppointmentsForDay(
    validatedParams.clientId,
    day,
    credentials,
  );
  const duplicate = findDuplicateAppointment(
    existingAppointments,
    validatedParams.startDate,
    resolvedType.eventType,
  );
  if (duplicate) {
    return toMcpToolResult({
      status: "skipped_duplicate",
      message:
        "An appointment with the same start date and type already exists for this client, so it was not recreated.",
      appointment: duplicate,
    });
  }

  const result = await requestGalienForCurrentUserBodyField(
    {
      method: "POST",
      path: "/api/v1/appointments",
      body: buildAppointmentCreateBody({
        clientId: validatedParams.clientId,
        startDate: validatedParams.startDate,
        endDate,
        appointmentTypeId: resolvedType.id,
        contactPersonId: validatedParams.contactPersonId,
        comment: validatedParams.comment,
      }),
    },
    "userId",
    credentials,
  );
  return toMcpToolResult(result);
}
