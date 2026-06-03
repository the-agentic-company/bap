import {
  buildPatchedContact,
  buildSyntheticContact,
  contactsListQuerySchema,
  contactsListResponseSchema,
  createContactInputSchema,
  findContactById,
  listContacts,
  notFoundResponse,
  readJsonBody,
  updateContactInputSchema,
  validationErrorResponse,
} from "@/lib/mock-openapi/crm";

/**
 * Framework-neutral handlers for the mock CRM contacts endpoints. Operate on standard
 * `Request`/`Response`; substantial fixture/validation logic lives in `@/lib/mock-openapi/crm`.
 * Public mock fixtures, so no authorization is applied by design.
 */

export async function listContactsHandler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = contactsListQuerySchema.safeParse({
    email: url.searchParams.get("email") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
  });

  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  const data = listContacts(parsed.data);
  return Response.json(contactsListResponseSchema.parse({ data, count: data.length }));
}

export async function createContactHandler(request: Request): Promise<Response> {
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = createContactInputSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  return Response.json(buildSyntheticContact(parsed.data));
}

export async function getContactHandler(id: string): Promise<Response> {
  const contact = findContactById(id);
  if (!contact) {
    return notFoundResponse("contact", id);
  }

  return Response.json(contact);
}

export async function patchContactHandler(request: Request, id: string): Promise<Response> {
  const existing = findContactById(id);
  if (!existing) {
    return notFoundResponse("contact", id);
  }

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) {
    return bodyResult.response;
  }

  const parsed = updateContactInputSchema.safeParse(bodyResult.body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }

  return Response.json(buildPatchedContact(existing, parsed.data));
}
