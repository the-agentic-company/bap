import { describe, expect, it } from "vitest";
import {
  prepareEmailHtmlBody,
  renderMessage,
  renderMessageToEmailHtml,
  renderMessageToPlainText,
  renderMessageToSlack,
  renderMessageToSlackPayload,
} from ".";

describe("message-format", () => {
  it("renders common markdown to Slack mrkdwn", () => {
    expect(
      renderMessageToSlack(
        "**Email reply shortlist**\n- **Reply now**\n  - Why: [Docs](https://example.com?a=1&b=2)\n~~old~~",
      ),
    ).toBe(
      "*Email reply shortlist*\n- *Reply now*\n  - Why: <https://example.com?a=1&b=2|Docs>\n~old~",
    );
  });

  it("renders common markdown to safe email HTML", () => {
    expect(
      renderMessageToEmailHtml(
        "### Follow-Up Meeting Scheduling Details\n*Please schedule the following calendar invites based on the call:*\n* **Meeting 1:** 2-hour deep-dive\n**Subject:** ~~Old~~ Next Steps",
      ),
    ).toBe(
      "<strong>Follow-Up Meeting Scheduling Details</strong><br><em>Please schedule the following calendar invites based on the call:</em><br>- <strong>Meeting 1:</strong> 2-hour deep-dive<br><strong>Subject:</strong> <s>Old</s> Next Steps",
    );
  });

  it("renders markdown tables to email HTML tables", () => {
    expect(
      renderMessageToEmailHtml(
        "| Feature | Expected |\n| --- | --- |\n| **Bold** | Works |\n| [Link](https://example.com) | Readable |",
      ),
    ).toBe(
      '<table style="border-collapse:collapse;width:100%;margin:12px 0;"><tr><th style="border:1px solid #d0d7de;padding:6px 8px;text-align:left;font-weight:bold;background:#f6f8fa;">Feature</th><th style="border:1px solid #d0d7de;padding:6px 8px;text-align:left;font-weight:bold;background:#f6f8fa;">Expected</th></tr><tr><td style="border:1px solid #d0d7de;padding:6px 8px;text-align:left;"><strong>Bold</strong></td><td style="border:1px solid #d0d7de;padding:6px 8px;text-align:left;">Works</td></tr><tr><td style="border:1px solid #d0d7de;padding:6px 8px;text-align:left;"><a href="https://example.com">Link</a></td><td style="border:1px solid #d0d7de;padding:6px 8px;text-align:left;">Readable</td></tr></table>',
    );
  });

  it("renders markdown links as clickable email anchors", () => {
    expect(
      renderMessageToEmailHtml(
        "[Cliquez ici pour consulter le rapport des visites du jour](http://localhost:3000/agents/info/previsites)",
      ),
    ).toBe(
      '<a href="http://localhost:3000/agents/info/previsites">Cliquez ici pour consulter le rapport des visites du jour</a>',
    );
  });

  it("renders common markdown to plain text", () => {
    expect(renderMessageToPlainText("**Email reply shortlist**\n- **Reply now**")).toBe(
      "Email reply shortlist\n- Reply now",
    );
  });

  it("normalizes escaped newlines before rendering", () => {
    expect(renderMessageToSlack("Hello\\n**team**")).toBe("Hello\n*team*");
    expect(renderMessageToEmailHtml("Hello\\n**team**")).toBe("Hello<br><strong>team</strong>");
  });

  it("escapes unsafe Slack brackets while preserving Slack tokens", () => {
    expect(renderMessageToSlack("Hi <@U123ABC> <b>bad</b> & done")).toBe(
      "Hi <@U123ABC> &lt;b&gt;bad&lt;/b&gt; &amp; done",
    );
  });

  it("renders bullets and tables to Slack Block Kit payloads", () => {
    const result = renderMessageToSlackPayload(
      "### Report\n- **Now**\n- [Later](https://example.com)\n\n| Feature | Result |\n| --- | --- |\n| **Bold** | Works |",
    );

    expect(result.text).toContain("*Report*");
    expect(result.blocks).toMatchObject([
      {
        type: "rich_text",
        elements: [
          {
            type: "rich_text_section",
            elements: [{ type: "text", text: "Report", style: { bold: true } }],
          },
          {
            type: "rich_text_list",
            style: "bullet",
            elements: [
              {
                type: "rich_text_section",
                elements: [{ type: "text", text: "Now", style: { bold: true } }],
              },
              {
                type: "rich_text_section",
                elements: [{ type: "link", text: "Later", url: "https://example.com" }],
              },
            ],
          },
        ],
      },
      {
        type: "table",
        rows: [
          [
            {
              type: "rich_text",
              elements: [
                { type: "rich_text_section", elements: [{ type: "text", text: "Feature" }] },
              ],
            },
            {
              type: "rich_text",
              elements: [
                { type: "rich_text_section", elements: [{ type: "text", text: "Result" }] },
              ],
            },
          ],
          [
            {
              type: "rich_text",
              elements: [
                {
                  type: "rich_text_section",
                  elements: [{ type: "text", text: "Bold", style: { bold: true } }],
                },
              ],
            },
            {
              type: "rich_text",
              elements: [
                { type: "rich_text_section", elements: [{ type: "text", text: "Works" }] },
              ],
            },
          ],
        ],
      },
    ]);
  });

  it("keeps allowed email HTML and converts embedded newlines", () => {
    expect(renderMessageToEmailHtml("Hello <strong>team</strong>\\nThanks\nRegards")).toBe(
      "Hello <strong>team</strong><br>Thanks<br>Regards",
    );
  });

  it("rejects unsupported email HTML", () => {
    expect(() => renderMessageToEmailHtml("<p>Hello</p><div>x</div>")).toThrow(
      "unsupported tag <div>",
    );
  });

  it("keeps the email compatibility wrapper", () => {
    expect(prepareEmailHtmlBody("Hello & **team**")).toEqual({
      html: "Hello &amp; <strong>team</strong>",
    });
  });

  it("returns discriminated render results", () => {
    expect(renderMessage("**hello**", "slack")).toEqual({
      kind: "text",
      target: "slack",
      text: "*hello*",
    });
    expect(renderMessage("**hello**", "email-html")).toEqual({
      kind: "html",
      target: "email-html",
      html: "<strong>hello</strong>",
    });
  });
});
