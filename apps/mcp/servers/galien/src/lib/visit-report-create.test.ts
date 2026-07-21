import { describe, expect, it } from "vitest";
import {
  addBapCommentMarker,
  buildVisitReportCreateBody,
  computeLinearPartCalculation,
  BAP_VISIT_REPORT_COMMENT_MARKER,
  GALIEN_VISIT_REPORT_CURRENT_VERSION,
  schema,
  type VisitReportCreateParams,
} from "../tools/visit-report.create";
import { validateGalienToolParams } from "./tool-helpers";

describe("addBapCommentMarker", () => {
  it("creates the comment when none is provided", () => {
    expect(addBapCommentMarker()).toBe(BAP_VISIT_REPORT_COMMENT_MARKER);
    expect(addBapCommentMarker("   ")).toBe(BAP_VISIT_REPORT_COMMENT_MARKER);
  });

  it("appends the Bap marker to an existing comment", () => {
    expect(addBapCommentMarker("Discussed follow-up plan.")).toBe(
      `Discussed follow-up plan.\n\n${BAP_VISIT_REPORT_COMMENT_MARKER}`,
    );
  });

  it("does not duplicate the Bap marker", () => {
    expect(
      addBapCommentMarker(
        `Discussed follow-up plan.\n\n${BAP_VISIT_REPORT_COMMENT_MARKER}`,
      ),
    ).toBe(`Discussed follow-up plan.\n\n${BAP_VISIT_REPORT_COMMENT_MARKER}`);
  });
});

describe("computeLinearPartCalculation", () => {
  it("computes BI over véto tablets as a two-decimal percentage", () => {
    expect(computeLinearPartCalculation(26, 9)).toBe("34.62%");
  });

  it("returns undefined without usable counts", () => {
    expect(computeLinearPartCalculation(0, 9)).toBeUndefined();
    expect(computeLinearPartCalculation(undefined, 9)).toBeUndefined();
    expect(computeLinearPartCalculation(26, undefined)).toBeUndefined();
  });
});

describe("buildVisitReportCreateBody", () => {
  it("defaults to a visit, keeps supported v5 fields and strips unsupported ones", () => {
    const validated = validateGalienToolParams(schema, {
      clientId: 14,
      contactPersonId: 56550,
      contactOutcomeId: 20,
      visitDate: "2026-05-27T12:08:00.000Z",
      duration: 1800,
      promotion: true, // not part of the schema -> stripped
      plvUse: [1], // now a supported Sell-Out field -> kept
    });

    expect(validated).toEqual({
      clientId: 14,
      contactPersonId: 56550,
      contactOutcomeId: 20,
      visitDate: "2026-05-27T12:08:00.000Z",
      duration: 1800,
      contactTypeId: 1,
      plvUse: [1],
    });
  });

  it("adds the current Galien visit report version and marks the comment", () => {
    expect(
      buildVisitReportCreateBody({
        clientId: 14,
        contactPersonId: 56550,
        contactOutcomeId: 20,
        visitDate: "2026-05-27T12:08:00.000Z",
        duration: 1800,
        contactTypeId: 1,
        comment: "Rapport de visite de test",
      }),
    ).toEqual({
      clientId: 14,
      contactPersonId: 56550,
      contactOutcomeId: 20,
      visitDate: "2026-05-27T12:08:00.000Z",
      duration: 1800,
      contactTypeId: 1,
      localisation: 1,
      pharmacySize: 1,
      averagePassagesPerDay: 1,
      comment: `Rapport de visite de test\n\n${BAP_VISIT_REPORT_COMMENT_MARKER}`,
      version: GALIEN_VISIT_REPORT_CURRENT_VERSION,
    });
  });

  it("passes through the stable v5 visit report fields used by the Galien frontend", () => {
    expect(
      buildVisitReportCreateBody({
        clientId: 14,
        contactPersonId: 56550,
        contactOutcomeId: 20,
        visitDate: "2026-05-27T12:08:00.000Z",
        duration: 1800,
        contactTypeId: 1,
        localisation: 2,
        pharmacySize: 3,
        averagePassagesPerDay: 4,
      }),
    ).toMatchObject({
      contactTypeId: 1,
      localisation: 2,
      pharmacySize: 3,
      averagePassagesPerDay: 4,
      version: "v5",
    });
  });

  it("adds frontend-required v5 defaults for visit reports", () => {
    expect(
      buildVisitReportCreateBody({
        clientId: 14,
        contactPersonId: 56550,
        contactOutcomeId: 20,
        visitDate: "2026-05-27T12:08:00.000Z",
        duration: 1800,
        contactTypeId: 1,
        comment: "Rapport de visite de test",
      }),
    ).toMatchObject({
      contactTypeId: 1,
      localisation: 1,
      pharmacySize: 1,
      averagePassagesPerDay: 1,
      comment: `Rapport de visite de test\n\n${BAP_VISIT_REPORT_COMMENT_MARKER}`,
      version: "v5",
    });
  });

  it("does not add visit-only v5 defaults for calls", () => {
    expect(
      buildVisitReportCreateBody({
        clientId: 14,
        contactPersonId: 56550,
        contactOutcomeId: 1,
        visitDate: "2026-05-27T12:08:00.000Z",
        duration: 1800,
        contactTypeId: 2,
      }),
    ).toMatchObject({
      contactTypeId: 2,
      comment: BAP_VISIT_REPORT_COMMENT_MARKER,
      version: "v5",
    });
  });

  it("reproduces the exact structured integers of real report #122857 (PHARMACIE CATTEAU)", () => {
    // Ground truth read back from GET /api/v1/visit-reports/122857 (Visite Argumentée,
    // 2026-07-03) and cross-checked against the live Galien form.
    const body = buildVisitReportCreateBody({
      clientId: 21352,
      contactPersonId: 1,
      contactOutcomeId: 20,
      visitDate: "2026-07-03T09:30:00.000Z",
      duration: 3600,
      contactTypeId: 1,
      comment: "Contact M. Catteau. Commande réassort + point MEA + point chiffres.",
      retrocession: false,
      localisation: 1,
      pharmacySize: 3,
      averagePassagesPerDay: 3,
      positioningOfProductsOnShelf: 3,
      doubleImplantation: 0,
      numberOfVetoTablets: 26,
      numberOfBiTablets: 9,
      plvUse: [1],
      brandPresence: [1, 2, 3, 4],
      eligibleForReferral: false,
      numberOfTrainedPeople: 1,
      numberOfCoursesOverLastYear: 0,
    });

    expect(body).toMatchObject({
      localisation: 1,
      pharmacySize: 3,
      averagePassagesPerDay: 3,
      positioningOfProductsOnShelf: 3,
      doubleImplantation: 0,
      numberOfVetoTablets: 26,
      numberOfBiTablets: 9,
      linearPartCalculation: "34.62%",
      plvUse: [1],
      brandPresence: [1, 2, 3, 4],
      eligibleForReferral: false,
      numberOfTrainedPeople: 1,
      numberOfCoursesOverLastYear: 0,
      retrocession: false,
      version: GALIEN_VISIT_REPORT_CURRENT_VERSION,
    });
    expect(body.comment).toContain("(made by Bap)");
  });

  it("auto-computes linearPartCalculation when omitted but keeps an explicit value", () => {
    const base: VisitReportCreateParams = {
      clientId: 14,
      contactPersonId: 1,
      contactOutcomeId: 20,
      visitDate: "2026-07-03T09:30:00.000Z",
      duration: 3600,
      contactTypeId: 1,
      numberOfVetoTablets: 26,
      numberOfBiTablets: 9,
    };
    expect(buildVisitReportCreateBody(base).linearPartCalculation).toBe("34.62%");
    expect(
      buildVisitReportCreateBody({ ...base, linearPartCalculation: "50.00%" }).linearPartCalculation,
    ).toBe("50.00%");
  });
});
