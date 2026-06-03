import { describe, expect, it } from "vitest";
import {
  createContactHandler,
  getContactHandler,
  listContactsHandler,
  patchContactHandler,
} from "./contacts";

describe("listContactsHandler", () => {
  it("returns fixture-backed contacts and supports filtering", async () => {
    const response = await listContactsHandler(
      new Request("https://app.example.com/api/mock/crm/contacts?status=lead"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.data[0]).toMatchObject({
      id: "contact_ava_stone",
      status: "lead",
    });
  });

  it("returns contacts without requiring authorization", async () => {
    const response = await listContactsHandler(
      new Request("https://app.example.com/api/mock/crm/contacts"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      count: 3,
    });
  });
});

describe("createContactHandler", () => {
  it("returns a synthetic created contact", async () => {
    const response = await createContactHandler(
      new Request("https://app.example.com/api/mock/crm/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "new.person@example.com",
          firstName: "New",
          lastName: "Person",
          company: "Example Co",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      email: "new.person@example.com",
      firstName: "New",
      lastName: "Person",
      company: "Example Co",
      status: "lead",
      createdAt: "2026-03-30T09:00:00.000Z",
      updatedAt: "2026-03-30T09:00:00.000Z",
    });
    expect(body.id).toMatch(/^contact_[a-f0-9]{10}$/);
  });

  it("returns validation errors for invalid payloads", async () => {
    const response = await createContactHandler(
      new Request("https://app.example.com/api/mock/crm/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "not-an-email",
          firstName: "",
          lastName: "Person",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe("validation_error");
    expect(body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "email" }),
        expect.objectContaining({ path: "firstName" }),
      ]),
    );
  });
});

describe("getContactHandler", () => {
  it("returns not found for unknown contacts", async () => {
    const response = await getContactHandler("missing");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "not_found",
      message: 'The contact "missing" was not found.',
    });
  });
});

describe("patchContactHandler", () => {
  it("returns a merged updated contact without persisting changes", async () => {
    const patchResponse = await patchContactHandler(
      new Request("https://app.example.com/api/mock/crm/contacts/contact_ava_stone", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          company: "Updated Co",
          status: "customer",
        }),
      }),
      "contact_ava_stone",
    );
    const patchBody = await patchResponse.json();

    expect(patchResponse.status).toBe(200);
    expect(patchBody).toMatchObject({
      id: "contact_ava_stone",
      company: "Updated Co",
      status: "customer",
      updatedAt: "2026-03-30T12:00:00.000Z",
    });

    const getResponse = await getContactHandler("contact_ava_stone");
    const getBody = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getBody).toMatchObject({
      id: "contact_ava_stone",
      company: "Acme Inc",
      status: "lead",
      updatedAt: "2026-01-15T10:00:00.000Z",
    });
  });

  it("returns validation errors for empty patches", async () => {
    const response = await patchContactHandler(
      new Request("https://app.example.com/api/mock/crm/contacts/contact_ava_stone", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
      "contact_ava_stone",
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toEqual({
      error: "validation_error",
      issues: [{ path: "body", message: "At least one field must be provided." }],
    });
  });
});
