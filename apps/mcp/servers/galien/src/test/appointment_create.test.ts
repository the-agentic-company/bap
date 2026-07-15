import { afterEach, describe, expect, it, vi } from "vitest";
import createAppointment, { BAP_APPOINTMENT_COMMENT_MARKER } from "../tools/appointment.create";

// Integration-style test: the Galien HTTP surface is stubbed so the full tool flow
// (credentials -> login -> resolve type -> idempotency -> create) runs, and the outgoing
// POST is asserted to be spec-compliant. Routing is a small table to keep each function simple.
const BASE = "https://api.frontline.galien.preprod.webhelpmedica.com";
const CREDS_URL = "https://bap.example/api/internal/mcp/galien-credentials";
const BEARER = `Bearer header.${Buffer.from(JSON.stringify({ id: 7 })).toString("base64url")}.sig`;
const EXTRA = {
  authInfo: { extra: { audience: "galien", userId: "bap-user-id", workspaceId: "workspace-id" } },
} as never;

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}
function reqMethod(init?: { method?: string }): string {
  return (init?.method ?? "GET").toUpperCase();
}
function reqBody(init?: { body?: unknown }): unknown {
  return init?.body ? JSON.parse(String(init.body)) : undefined;
}

type RecordedCall = { url: string; method: string; body: unknown };
type Route = { match: (url: string, method: string) => boolean; res: () => Response };

function stubGalien(existing: unknown[]): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const routes: Route[] = [
    { match: (u) => u === CREDS_URL, res: () => json({ username: "u@example.com", password: "pw", targetEnv: "preprod", apiBaseUrl: BASE }) },
    { match: (u) => u.endsWith("/api/v1/tokens/login"), res: () => new Response("[]", { status: 200, headers: { authorization: BEARER } }) },
    { match: (u) => u.includes("/api/v1/appointment-types"), res: () => json({ data: [{ id: 2, eventType: "Visite Argumentée" }, { id: 4, eventType: "Visite Sell-out" }] }) },
    { match: (u, m) => u.endsWith("/api/v1/appointments") && m === "POST", res: () => json({ id: 999 }, 201) },
    { match: (u) => u.includes("/appointments"), res: () => json({ total: existing.length, data: existing }) },
  ];
  vi.stubEnv("APP_SERVER_URL", "https://bap.example");
  vi.stubEnv("APP_SERVER_SECRET", "server-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: { method?: string; body?: unknown }) => {
      const url = String(input);
      const method = reqMethod(init);
      calls.push({ url, method, body: reqBody(init) });
      const route = routes.find((entry) => entry.match(url, method));
      if (!route) {
        throw new Error(`unexpected fetch ${method} ${url}`);
      }
      return route.res();
    }),
  );
  return calls;
}

describe("appointment.create (integration)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("posts a spec-compliant appointment (userId injected, type resolved, endDate derived, comment marked)", async () => {
    const calls = stubGalien([]);

    await createAppointment(
      {
        clientId: 14,
        startDate: "2026-07-29T09:00:00.000Z",
        appointmentType: "Visite Argumentée",
        contactPersonId: 56087,
        comment: "Point stock avant les congés",
        durationMinutes: 60,
      },
      EXTRA,
    );

    const post = calls.find((call) => call.method === "POST" && call.url.endsWith("/api/v1/appointments"));
    expect(post).toBeDefined();
    expect(post?.body).toMatchObject({
      clientId: 14,
      userId: 7,
      appointmentTypeId: 2,
      startDate: "2026-07-29T09:00:00.000Z",
      endDate: "2026-07-29T10:00:00.000Z",
      contactPersonId: 56087,
      comment: `Point stock avant les congés\n\n${BAP_APPOINTMENT_COMMENT_MARKER}`,
    });
  });

  it("does not post when an identical appointment already exists", async () => {
    const calls = stubGalien([{ id: 1, startDate: "2026-07-29T09:00:00.000Z", eventType: "Visite argumentée" }]);

    await createAppointment(
      {
        clientId: 14,
        startDate: "2026-07-29T09:00:00.000Z",
        appointmentType: "Visite Argumentée",
        durationMinutes: 60,
      },
      EXTRA,
    );

    expect(calls.some((call) => call.method === "POST" && call.url.endsWith("/api/v1/appointments"))).toBe(false);
  });
});
