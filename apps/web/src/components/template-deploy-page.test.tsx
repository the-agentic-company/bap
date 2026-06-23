// @vitest-environment jsdom

import * as jestDomVitest from "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { getTemplateDeployPromptTemplate } from "@bap/prompts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type VitestProcedure = Extract<
  NonNullable<Parameters<typeof vi.fn>[0]>,
  (...args: never[]) => unknown
>;
import { COWORKER_AVAILABLE_INTEGRATION_TYPES } from "@/lib/integration-icons";
import { callFollowUpTemplate } from "@/test/template-catalog-fixtures";

void jestDomVitest;

const {
  mockCreateCoworkerMutateAsync,
  mockGetOrCreateBuilderConversation,
  mockStartGeneration,
  fetchMock,
  assignMock,
} = vi.hoisted(() => ({
  mockCreateCoworkerMutateAsync: vi.fn<VitestProcedure>(),
  mockGetOrCreateBuilderConversation: vi.fn<VitestProcedure>(),
  mockStartGeneration: vi.fn<VitestProcedure>(),
  fetchMock: vi.fn<VitestProcedure>(),
  assignMock: vi.fn<VitestProcedure>(),
}));

vi.mock("@/orpc/hooks/coworkers", () => ({
  useCreateCoworker: () => ({ mutateAsync: mockCreateCoworkerMutateAsync }),
}));

vi.mock("@/orpc/client", () => ({
  client: {
    coworker: {
      getOrCreateBuilderConversation: mockGetOrCreateBuilderConversation,
    },
    generation: {
      startGeneration: mockStartGeneration,
    },
  },
}));

import { TemplateDeployPage } from "./template-deploy-page";

describe("TemplateDeployPage", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mockCreateCoworkerMutateAsync.mockReset();
    mockGetOrCreateBuilderConversation.mockReset();
    mockStartGeneration.mockReset();
    fetchMock.mockReset();
    assignMock.mockReset();

    mockCreateCoworkerMutateAsync.mockResolvedValue({ id: "cw-1" });
    mockGetOrCreateBuilderConversation.mockResolvedValue({ conversationId: "conv-1" });
    mockStartGeneration.mockResolvedValue({ generationId: "gen-1" });
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => getTemplateDeployPromptTemplate(),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign: assignMock,
      },
    });
  });

  it("creates a coworker from the template and redirects to its editor", async () => {
    render(<TemplateDeployPage template={callFollowUpTemplate} />);

    await waitFor(() => {
      expect(mockCreateCoworkerMutateAsync).toHaveBeenCalledWith({
        name: "Send polished follow-ups right after every call",
        triggerType: "webhook",
        prompt: `Get call details with aircall_get_call using your Aircall connection ID.
Get transcription with aircall_get_transcription using your Aircall connection ID.
Extract the external participant phone number from number.raw_digits.
Search HubSpot contacts by phone with hubspot_search_contacts and request properties: email, firstname, lastname.
If contact payload is incomplete, call hubspot_get_contact to fill missing fields.
Generate a 2-3 sentence call summary and explicit action items for both parties.
If contact email exists, create a Gmail draft with friendly greeting, short summary, bullet action items, and professional closing.
Create a HubSpot task with subject 'Follow up on call with [Contact Name]', include summary + actions, and schedule for tomorrow at 9 AM.
If contact exists, associate task to contact using HUBSPOT_DEFINED association type 204.
If no contact is found, skip Gmail draft and still create the HubSpot task with the phone number in the body.`,
        model: "openai/gpt-5.5",
        authSource: "shared",
        allowedIntegrations: COWORKER_AVAILABLE_INTEGRATION_TYPES,
      });
    });

    await waitFor(() => {
      expect(mockGetOrCreateBuilderConversation).toHaveBeenCalledWith({ id: "cw-1" });
      expect(mockStartGeneration).toHaveBeenCalledWith({
        conversationId: "conv-1",
        content: expect.stringContaining(
          "Create it with name Send polished follow-ups right after every call",
        ),
        model: "openai/gpt-5.5",
        authSource: "shared",
        autoApprove: true,
      });
      expect(assignMock).toHaveBeenCalledWith("/agents/edit/cw-1");
    });
  });

  it("shows an error when the template id is invalid", async () => {
    render(<TemplateDeployPage template={null} />);

    await waitFor(() => {
      expect(screen.getByText("Template not found.")).toBeInTheDocument();
    });

    expect(mockCreateCoworkerMutateAsync).not.toHaveBeenCalled();
  });

  it("shows the normalized builder error when generation start fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockStartGeneration.mockRejectedValue({
      code: "BAD_REQUEST",
      message:
        "Selected ChatGPT model is not available for your current connection. Choose another model and retry.",
      data: {
        generationErrorCode: "model_access_denied",
        phase: "start_rpc",
      },
    });

    render(<TemplateDeployPage template={callFollowUpTemplate} />);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Selected ChatGPT model is not available for your current connection. Choose another model and retry.",
        ),
      ).toBeInTheDocument();
    });
    expect(assignMock).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
