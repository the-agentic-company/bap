import { z } from "zod";
import type { ToolExtraArguments } from "xmcp";
import {
  requestGalien,
  requestGalienForCurrentUser,
  requestGalienForCurrentUserPathParam,
  splitGalienRequestParts,
  type GalienQueryValue,
} from "./galien-client";
import { getManagedGalienToolCredentials } from "./galien-auth";

const galienScalarSchema = z.union([z.string(), z.number(), z.boolean()]);
export const galienQueryValueSchema = z.union([galienScalarSchema, z.array(galienScalarSchema)]);
const isoUtcDateTimeWithMillisecondsPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoUtcDateTimeWithMilliseconds(value: string) {
  if (!isoUtcDateTimeWithMillisecondsPattern.test(value)) {
    return false;
  }

  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isValidDateOnly(value: string) {
  if (!dateOnlyPattern.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

export const galienIsoDateTimeSchema = z
  .string()
  .refine(isValidIsoUtcDateTimeWithMilliseconds, {
    message:
      'Must be an ISO 8601 UTC datetime with milliseconds, for example "2026-04-28T00:00:00.000Z". Do not use date-only strings or timezone offsets.',
  })
  .describe(
    "ISO 8601 UTC datetime with milliseconds, for example 2026-04-28T00:00:00.000Z. Date-only values like 2026-04-28 are rejected by Galien.",
  );
export const galienDateOnlySchema = z
  .string()
  .refine(isValidDateOnly, {
    message: 'Must be a date-only string in YYYY-MM-DD format, for example "2026-04-28".',
  })
  .describe("Galien date-only string in YYYY-MM-DD format, for example 2026-04-28.");

export function validateGalienToolParams<T extends z.ZodRawShape>(
  schema: T,
  params: unknown,
): z.infer<z.ZodObject<T>> {
  return z.object(schema).parse(params);
}

export async function requestGalienGet(
  path: string,
  params: Record<string, GalienQueryValue | undefined>,
  extra?: ToolExtraArguments,
) {
  const requestParts = splitGalienRequestParts(path, params);
  const credentials = await getManagedGalienToolCredentials(extra);
  return requestGalien({
    method: "GET",
    path,
    ...requestParts,
  }, credentials);
}

export async function requestCurrentGalienUserGet(
  path: string,
  params: Record<string, GalienQueryValue | undefined>,
  extra?: ToolExtraArguments,
) {
  const requestParts = splitGalienRequestParts(path, params);
  const credentials = await getManagedGalienToolCredentials(extra);

  return requestGalienForCurrentUser({
    method: "GET",
    path,
    ...requestParts,
  }, credentials);
}

export async function requestCurrentGalienUserPathParamGet(
  path: string,
  currentUserPathParam: string,
  params: Record<string, GalienQueryValue | undefined>,
  extra?: ToolExtraArguments,
) {
  const requestParts = splitGalienRequestParts(path, params);
  const credentials = await getManagedGalienToolCredentials(extra);

  return requestGalienForCurrentUserPathParam({
    method: "GET",
    path,
    ...requestParts,
  }, currentUserPathParam, credentials);
}
