import { describe, expect, it } from "vitest";
import {
  acceptsOperationRestrictions,
  resolveWorkspaceIntegrationPolicy,
  type WorkspaceIntegrationOperationRestriction,
  type WorkspaceIntegrationPolicyMode,
} from "./policy-resolver";

describe("resolveWorkspaceIntegrationPolicy", () => {
  const cases: Array<{
    name: string;
    parentMode?: WorkspaceIntegrationPolicyMode | null;
    restriction?: WorkspaceIntegrationOperationRestriction | null;
    autoApprove: boolean;
    expected: ReturnType<typeof resolveWorkspaceIntegrationPolicy>;
  }> = [
    {
      name: "uses the permissive implicit default",
      autoApprove: false,
      expected: { decision: "auto_approved", source: "implicit_default" },
    },
    {
      name: "honors an explicit auto-approved parent",
      parentMode: "auto_approved",
      autoApprove: false,
      expected: { decision: "auto_approved", source: "parent_auto_approved" },
    },
    {
      name: "requires approval under a uniform parent",
      parentMode: "requires_approval",
      autoApprove: false,
      expected: { decision: "requires_approval", source: "parent_requires_approval" },
    },
    {
      name: "lets Generation consent bypass a uniform approval requirement",
      parentMode: "requires_approval",
      autoApprove: true,
      expected: { decision: "auto_approved", source: "generation_auto_approve" },
    },
    {
      name: "makes parent denial terminal",
      parentMode: "denied",
      restriction: "requires_approval",
      autoApprove: true,
      expected: { decision: "denied", source: "parent_denied" },
    },
    {
      name: "uses auto-approved as the personalized baseline",
      parentMode: "personalized",
      autoApprove: false,
      expected: { decision: "auto_approved", source: "personalized_default" },
    },
    {
      name: "requires approval for a personalized restriction",
      parentMode: "personalized",
      restriction: "requires_approval",
      autoApprove: false,
      expected: { decision: "requires_approval", source: "operation_requires_approval" },
    },
    {
      name: "lets Generation consent bypass a personalized approval requirement",
      parentMode: "personalized",
      restriction: "requires_approval",
      autoApprove: true,
      expected: { decision: "auto_approved", source: "generation_auto_approve" },
    },
    {
      name: "makes personalized operation denial terminal",
      parentMode: "personalized",
      restriction: "denied",
      autoApprove: true,
      expected: { decision: "denied", source: "operation_denied" },
    },
    {
      name: "ignores invalid child loosening on a uniform approval parent",
      parentMode: "requires_approval",
      restriction: "denied",
      autoApprove: false,
      expected: { decision: "requires_approval", source: "parent_requires_approval" },
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(
        resolveWorkspaceIntegrationPolicy({
          parentMode: testCase.parentMode,
          operationRestriction: testCase.restriction,
          generationAutoApprove: testCase.autoApprove,
        }),
      ).toEqual(testCase.expected);
    });
  }

  it("only accepts child restrictions for Personalized mode", () => {
    expect(acceptsOperationRestrictions("personalized")).toBe(true);
    expect(acceptsOperationRestrictions("auto_approved")).toBe(false);
    expect(acceptsOperationRestrictions("requires_approval")).toBe(false);
    expect(acceptsOperationRestrictions("denied")).toBe(false);
  });
});
