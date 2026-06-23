import { describe, expect, it } from "vitest";
import { getTemplateDeployPromptTemplate } from "@bap/prompts";
import { buildTemplateDeployPayload, renderTemplateDeployPrompt } from "@/lib/template-deploy";
import { callFollowUpTemplate } from "@/test/template-catalog-fixtures";

const PROMPT_TEMPLATE = getTemplateDeployPromptTemplate();

describe("renderTemplateDeployPrompt", () => {
  it("fills all placeholders and keeps the required sections", () => {
    expect(renderTemplateDeployPrompt(PROMPT_TEMPLATE, callFollowUpTemplate))
      .toBe(`Create it with name Send polished follow-ups right after every call

Trigger

Call Transcription Ready

When an Aircall call transcription becomes available.

Instructions

Get call details with aircall_get_call using your Aircall connection ID.
Get transcription with aircall_get_transcription using your Aircall connection ID.
Extract the external participant phone number from number.raw_digits.
Search HubSpot contacts by phone with hubspot_search_contacts and request properties: email, firstname, lastname.
If contact payload is incomplete, call hubspot_get_contact to fill missing fields.
Generate a 2-3 sentence call summary and explicit action items for both parties.
If contact email exists, create a Gmail draft with friendly greeting, short summary, bullet action items, and professional closing.
Create a HubSpot task with subject 'Follow up on call with [Contact Name]', include summary + actions, and schedule for tomorrow at 9 AM.
If contact exists, associate task to contact using HUBSPOT_DEFINED association type 204.
If no contact is found, skip Gmail draft and still create the HubSpot task with the phone number in the body.
`);
  });
});

describe("buildTemplateDeployPayload", () => {
  it("maps template fields into coworker create payload and builder message", () => {
    const payload = buildTemplateDeployPayload(callFollowUpTemplate, PROMPT_TEMPLATE);

    expect(payload.createPayload).toEqual({
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
    });
    expect(payload.initialBuilderMessage).toContain(
      "Create it with name Send polished follow-ups right after every call",
    );
  });
});
