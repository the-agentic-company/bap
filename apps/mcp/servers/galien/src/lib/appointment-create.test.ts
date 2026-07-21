import { describe, expect, it } from "vitest";
import {
  addBapAppointmentCommentMarker,
  BAP_APPOINTMENT_COMMENT_MARKER,
  buildAppointmentCreateBody,
  deriveAppointmentEndDate,
  extractAppointmentTypes,
  extractClientAppointments,
  extractClientAppointmentsTotal,
  findDuplicateAppointment,
  normalizeAppointmentTypeLabel,
  resolveAppointmentType,
} from "../tools/appointment.create";

const TYPES = [
  { id: 1, eventType: "Rappel" },
  { id: 2, eventType: "Visite Argumentée" },
  { id: 3, eventType: "Visite Opportuniste" },
  { id: 4, eventType: "Visite Sell-out" },
];

describe("normalizeAppointmentTypeLabel", () => {
  it("ignores case, accents, spaces and hyphens", () => {
    expect(normalizeAppointmentTypeLabel("Visite Argumentée")).toBe("visiteargumentee");
    expect(normalizeAppointmentTypeLabel("visite  sell-out")).toBe("visitesellout");
  });
});

describe("resolveAppointmentType", () => {
  it("resolves a label case- and accent-insensitively", () => {
    expect(resolveAppointmentType({ appointmentType: "visite argumentee" }, TYPES)).toEqual({
      id: 2,
      eventType: "Visite Argumentée",
    });
    expect(resolveAppointmentType({ appointmentType: "Visite Sell-Out" }, TYPES)).toEqual({
      id: 4,
      eventType: "Visite Sell-out",
    });
  });

  it("prefers an explicit id and returns its known label", () => {
    expect(resolveAppointmentType({ appointmentTypeId: 3 }, TYPES)).toEqual({
      id: 3,
      eventType: "Visite Opportuniste",
    });
  });

  it("throws on an unknown label", () => {
    expect(() => resolveAppointmentType({ appointmentType: "Nope" }, TYPES)).toThrow(
      /Unknown appointment type/,
    );
  });

  it("throws when neither id nor label is provided", () => {
    expect(() => resolveAppointmentType({}, TYPES)).toThrow(
      /either appointmentTypeId or appointmentType/,
    );
  });
});

describe("deriveAppointmentEndDate", () => {
  it("keeps an explicit endDate", () => {
    expect(
      deriveAppointmentEndDate("2026-07-29T09:00:00.000Z", "2026-07-29T10:30:00.000Z", 60),
    ).toBe("2026-07-29T10:30:00.000Z");
  });

  it("derives endDate from durationMinutes when omitted", () => {
    expect(deriveAppointmentEndDate("2026-07-29T09:00:00.000Z", undefined, 60)).toBe(
      "2026-07-29T10:00:00.000Z",
    );
  });
});

describe("findDuplicateAppointment", () => {
  const existing = [
    { id: 1, startDate: "2026-07-29T09:00:00.000Z", eventType: "Visite argumentée" },
    { id: 2, startDate: "2026-09-04T10:00:00.000Z", eventType: "Visite Sell-out" },
  ];

  it("matches the same start date and type ignoring accents/case", () => {
    expect(
      findDuplicateAppointment(existing, "2026-07-29T09:00:00.000Z", "Visite Argumentée")?.id,
    ).toBe(1);
  });

  it("does not match a different start date", () => {
    expect(
      findDuplicateAppointment(existing, "2026-07-29T11:00:00.000Z", "Visite Argumentée"),
    ).toBeUndefined();
  });

  it("does not match a different type", () => {
    expect(
      findDuplicateAppointment(existing, "2026-07-29T09:00:00.000Z", "Visite Sell-out"),
    ).toBeUndefined();
  });

  it("does not match when the existing appointment type is missing", () => {
    expect(
      findDuplicateAppointment(
        [{ id: 3, startDate: "2026-07-29T09:00:00.000Z" }],
        "2026-07-29T09:00:00.000Z",
        "Visite Argumentée",
      ),
    ).toBeUndefined();
  });
});

describe("addBapAppointmentCommentMarker", () => {
  it("creates the comment when none is provided", () => {
    expect(addBapAppointmentCommentMarker()).toBe(BAP_APPOINTMENT_COMMENT_MARKER);
    expect(addBapAppointmentCommentMarker("   ")).toBe(BAP_APPOINTMENT_COMMENT_MARKER);
  });

  it("appends the marker and does not duplicate it", () => {
    expect(addBapAppointmentCommentMarker("Point stock")).toBe(
      `Point stock\n\n${BAP_APPOINTMENT_COMMENT_MARKER}`,
    );
    expect(addBapAppointmentCommentMarker(`Point stock\n\n${BAP_APPOINTMENT_COMMENT_MARKER}`)).toBe(
      `Point stock\n\n${BAP_APPOINTMENT_COMMENT_MARKER}`,
    );
  });
});

describe("buildAppointmentCreateBody", () => {
  it("builds the POST body and marks the comment", () => {
    expect(
      buildAppointmentCreateBody({
        clientId: 14,
        startDate: "2026-07-29T09:00:00.000Z",
        endDate: "2026-07-29T10:00:00.000Z",
        appointmentTypeId: 2,
        contactPersonId: 56087,
        comment: "Point stock",
      }),
    ).toEqual({
      clientId: 14,
      startDate: "2026-07-29T09:00:00.000Z",
      endDate: "2026-07-29T10:00:00.000Z",
      appointmentTypeId: 2,
      contactPersonId: 56087,
      comment: `Point stock\n\n${BAP_APPOINTMENT_COMMENT_MARKER}`,
    });
  });

  it("omits contactPersonId when it is not provided", () => {
    const body = buildAppointmentCreateBody({
      clientId: 14,
      startDate: "2026-07-29T09:00:00.000Z",
      endDate: "2026-07-29T10:00:00.000Z",
      appointmentTypeId: 2,
    });
    expect(body).not.toHaveProperty("contactPersonId");
  });
});

describe("extractors", () => {
  it("reads appointment types from a wrapped or bare payload", () => {
    expect(extractAppointmentTypes({ data: TYPES })).toHaveLength(4);
    expect(extractAppointmentTypes(TYPES)).toHaveLength(4);
    expect(extractAppointmentTypes({})).toEqual([]);
    expect(extractAppointmentTypes(null)).toEqual([]);
  });

  it("reads client appointments from the total/data envelope", () => {
    expect(
      extractClientAppointments({ total: 1, data: [{ id: 1, startDate: "x", eventType: "y" }] }),
    ).toHaveLength(1);
    expect(extractClientAppointments({})).toEqual([]);
  });

  it("reads a valid client appointment total", () => {
    expect(extractClientAppointmentsTotal({ total: 2, data: [] })).toBe(2);
    expect(extractClientAppointmentsTotal({ total: -1, data: [] })).toBeUndefined();
    expect(extractClientAppointmentsTotal({ total: "2", data: [] })).toBeUndefined();
  });
});
