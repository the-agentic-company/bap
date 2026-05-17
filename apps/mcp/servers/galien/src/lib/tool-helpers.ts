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
export const galienIsoDateTimeSchema = z
  .string()
  .describe(
    "ISO 8601 UTC datetime with milliseconds, for example 2026-04-28T00:00:00.000Z. Date-only values like 2026-04-28 are rejected by Galien.",
  );

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
