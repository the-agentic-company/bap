import {
  buildSyntheticDeal,
  createDealInputSchema,
  dealsListQuerySchema,
  dealsListResponseSchema,
  findContactById,
  listDeals,
  readJsonBody,
  validationErrorResponse,
} from "@/lib/mock-openapi/crm";

/**
 * Framework-neutral handlers for the mock CRM deals endpoints. Operate on standard
 * `Request`/`Response`; substantial fixture/validation logic lives in `@/lib/mock-openapi/crm`.
 * Public mock fixtures, so no authorization is applied by design.
 */

export async function listDealsHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = dealsListQuerySchema.safeParse({
    contactId: url.searchParams.get("contactId") ?? undefined,
    stage: url.searchParams.get("stage") ?? undefined,
  });

  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  const data = listDeals(parsed.data);
  return Response.json(dealsListResponseSchema.parse({ data, count: data.length }));
}

export async function createDealHandler(request: Request): Promise<Response> {
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = createDealInputSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  if (!findContactById(parsed.data.contactId)) {
    return validationErrorResponse([
      {
        path: "contactId",
        message: "contactId must reference a fixture-backed contact.",
      },
    ]);
  }

  return Response.json(buildSyntheticDeal(parsed.data));
}
