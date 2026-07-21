import { z } from "zod";
import { type InferSchema, type ToolExtraArguments, type ToolMetadata } from "xmcp";
import { toMcpToolResult } from "../../../../shared/tool-result";
import { requestGalienForCurrentUserBodyField } from "../lib/galien-client";
import { getManagedGalienToolCredentials } from "../lib/galien-auth";
import { galienIsoDateTimeSchema, validateGalienToolParams } from "../lib/tool-helpers";

export const GALIEN_VISIT_REPORT_CURRENT_VERSION = "v5";
export const BAP_VISIT_REPORT_COMMENT_MARKER = "(made by Bap)";

export const schema = {
  clientId: z.number().int().describe("Galien client/pharmacy id, for example 14."),
  contactPersonId: z.number().int().describe("Galien contact person id for the client."),
  contactOutcomeId: z
    .number()
    .int()
    .describe("Galien contact outcome id. For a visit, use an outcome whose type is Visite, for example 20 for Visite Argumentée."),
  visitDate: galienIsoDateTimeSchema
    .describe(
      "Visit date. Use a past or current ISO 8601 UTC datetime with milliseconds, for example 2026-04-28T10:00:00.000Z. Galien may reject future visit dates.",
    ),
  duration: z
    .number()
    .int()
    .positive()
    .describe("Duration in seconds. Use 1800 for a 30-minute visit."),
  contactTypeId: z
    .union([z.literal(1), z.literal(2)])
    .default(1)
    .describe("Galien contact type id: 1 for Visite, 2 for Appel. Defaults to 1."),
  comment: z.string().optional().describe("Free-text report comment (contact + key points)."),

  // Actions
  retrocession: z
    .boolean()
    .optional()
    .describe("Actions field. Rétrocession: true for Oui, false for Non."),

  // Infos officine (v5). Pass the REAL value when known; omit to keep Galien defaults.
  localisation: z
    .number()
    .int()
    .optional()
    .describe("Infos officine · Localisation. 1=Urbaine, 2=Rurale, 3=Centre commercial."),
  pharmacySize: z
    .number()
    .int()
    .optional()
    .describe(
      "Infos officine · Taille de l'officine. 1=Petite (2-5), 2=Moyenne (6-12), 3=Grande (13-30), 4=Très grande (+30).",
    ),
  averagePassagesPerDay: z
    .number()
    .int()
    .optional()
    .describe("Infos officine · Nombre moyen de passages par jour. 1=100-200, 2=200-400, 3=400-600, 4=>600."),

  // Sell-Out (v5)
  positioningOfProductsOnShelf: z
    .number()
    .int()
    .optional()
    .describe("Sell-Out · Positionnement des produits en rayon. 1=Non visible, 2=Derrière comptoir, 3=Accès libre."),
  doubleImplantation: z
    .number()
    .int()
    .optional()
    .describe("Sell-Out · Double implantation (MEA, TG). 0=Non, 1=Oui."),
  numberOfVetoTablets: z
    .number()
    .int()
    .optional()
    .describe("Sell-Out · Nombre de Tablettes véto (APE + API). Actual count."),
  numberOfBiTablets: z
    .number()
    .int()
    .optional()
    .describe("Sell-Out · Nombre de Tablettes BI. Actual count."),
  linearPartCalculation: z
    .string()
    .optional()
    .describe('Sell-Out · Calcul part de linéaire, for example "34.62%". Auto-computed from BI/véto tablets when omitted.'),
  plvUse: z
    .array(z.number().int())
    .optional()
    .describe("Sell-Out · Utilisation des supports PLV (multi-select ids). 1=Linéaire, 2=Hors linéaire, 3=Non."),
  brandPresence: z
    .array(z.number().int())
    .optional()
    .describe(
      "Sell-Out · Présence de marques APE+API (multi-select ids). 1=Boehringer Ingelheim, 2=Elanco, 3=Biocanina, 4=Clément Thékan, 5=Autres.",
    ),
  eligibleForReferral: z
    .boolean()
    .optional()
    .describe("Sell-Out · Éligible au plan de portage. true/false."),
  plvOptions: z
    .array(
      z.object({
        plvLabel: z.string().optional(),
        optionsIds: z.array(z.number().int()).optional(),
      }),
    )
    .optional()
    .describe("Sell-Out · Detailed PLV placements (from /api/v1/plv-lists). Usually empty."),

  // Formation (v5)
  numberOfTrainedPeople: z
    .number()
    .int()
    .optional()
    .describe("Formation · Nombre de personnes formées (bracket). 1=0-25%, 2=25-50%, 3=50-75%, 4=75-100%."),
  numberOfCoursesOverLastYear: z
    .number()
    .int()
    .optional()
    .describe("Formation · Nombre de formations réalisées sur la dernière année. Actual count."),
};

export type VisitReportCreateParams = z.infer<z.ZodObject<typeof schema>>;

const GALIEN_VISIT_CONTACT_TYPE_ID = 1;
// Galien requires these v5 Infos fields; keep sane defaults only when the caller
// provides nothing, so a bare report still validates.
const DEFAULT_VISIT_REPORT_V5_FIELDS: Partial<VisitReportCreateParams> = {
  localisation: 1,
  pharmacySize: 1,
  averagePassagesPerDay: 1,
};

export const metadata: ToolMetadata = {
  name: "visit-report.create",
  description:
    "Create a Galien visit report with POST /api/v1/visit-reports (version v5). Send the required ids, a past/current visitDate and a duration in minutes. Optional structured fields mirror the Galien form: retrocession, Infos officine (localisation, pharmacySize, averagePassagesPerDay), Sell-Out (positioningOfProductsOnShelf, doubleImplantation, numberOfVetoTablets, numberOfBiTablets, plvUse, brandPresence, eligibleForReferral) and Formation (numberOfTrainedPeople, numberOfCoursesOverLastYear). Encode choice fields with the numeric ids documented on each field; linearPartCalculation is derived from the tablet counts when omitted.",
  annotations: {
    title: "Create visit report",
  },
};

export function addBapCommentMarker(comment?: string) {
  const existingComment = comment ?? "";
  const trimmedComment = existingComment.trim();

  if (!trimmedComment) {
    return BAP_VISIT_REPORT_COMMENT_MARKER;
  }

  if (existingComment.includes(BAP_VISIT_REPORT_COMMENT_MARKER)) {
    return existingComment;
  }

  return `${existingComment.trimEnd()}\n\n${BAP_VISIT_REPORT_COMMENT_MARKER}`;
}

// "Part de linéaire" in Galien is the BI tablets as a share of the véto tablets,
// rendered with two decimals (for example 9 / 26 -> "34.62%").
export function computeLinearPartCalculation(
  numberOfVetoTablets?: number,
  numberOfBiTablets?: number,
): string | undefined {
  if (
    typeof numberOfVetoTablets !== "number" ||
    typeof numberOfBiTablets !== "number" ||
    numberOfVetoTablets <= 0
  ) {
    return undefined;
  }
  return `${((numberOfBiTablets / numberOfVetoTablets) * 100).toFixed(2)}%`;
}

export function buildVisitReportCreateBody(params: VisitReportCreateParams) {
  const defaultFields = params.contactTypeId === GALIEN_VISIT_CONTACT_TYPE_ID
    ? DEFAULT_VISIT_REPORT_V5_FIELDS
    : {};

  const linearPartCalculation =
    params.linearPartCalculation ??
    computeLinearPartCalculation(params.numberOfVetoTablets, params.numberOfBiTablets);

  return {
    ...defaultFields,
    ...params,
    ...(linearPartCalculation ? { linearPartCalculation } : {}),
    comment: addBapCommentMarker(params.comment),
    version: GALIEN_VISIT_REPORT_CURRENT_VERSION,
  };
}

export default async function createVisitReport(params: InferSchema<typeof schema>, extra?: ToolExtraArguments) {
  const validatedParams = validateGalienToolParams(schema, params);
  const credentials = await getManagedGalienToolCredentials(extra);
  const result = await requestGalienForCurrentUserBodyField({
    method: "POST",
    path: "/api/v1/visit-reports",
    body: buildVisitReportCreateBody(validatedParams),
  }, "userId", credentials);
  return toMcpToolResult(result);
}
