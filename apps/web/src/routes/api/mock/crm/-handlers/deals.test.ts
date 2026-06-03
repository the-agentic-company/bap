import { describe, expect, it } from "vitest";
import { createDealHandler, listDealsHandler } from "./deals";

describe("listDealsHandler", () => {
  it("returns fixture-backed deals and supports filtering", async () => {
    const response = await listDealsHandler(
      new Request("https://app.example.com/api/mock/crm/deals?stage=qualified"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.data[0]).toMatchObject({
      id: "deal_northwind_renewal",
      stage: "qualified",
    });
  });

  it("returns deals without requiring authorization", async () => {
    const response = await listDealsHandler(
      new Request("https://app.example.com/api/mock/crm/deals"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      count: 2,
    });
  });
});

describe("createDealHandler", () => {
  it("returns a synthetic created deal", async () => {
    const response = await createDealHandler(
      new Request("https://app.example.com/api/mock/crm/deals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Expansion Plan",
          contactId: "contact_liam_hart",
          stage: "won",
          value: 42000,
          currency: "usd",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      name: "Expansion Plan",
      contactId: "contact_liam_hart",
      stage: "won",
      value: 42000,
      currency: "USD",
      createdAt: "2026-03-30T09:00:00.000Z",
    });
    expect(body.id).toMatch(/^deal_[a-f0-9]{10}$/);
  });

  it("returns validation errors for invalid deal payloads", async () => {
    const response = await createDealHandler(
      new Request("https://app.example.com/api/mock/crm/deals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "",
          contactId: "missing-contact",
          value: -10,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toBe("validation_error");
    expect(body.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "name" }),
        expect.objectContaining({ path: "value" }),
      ]),
    );
  });
});
