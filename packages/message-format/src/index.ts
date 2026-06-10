const ALLOWED_EMAIL_HTML_TAGS = [
  "b",
  "strong",
  "s",
  "i",
  "em",
  "u",
  "br",
  "p",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
] as const;

const ALLOWED_EMAIL_HTML_TAG_SET = new Set<string>(ALLOWED_EMAIL_HTML_TAGS);
const ALLOWED_EMAIL_HTML_TAGS_TEXT = ALLOWED_EMAIL_HTML_TAGS.join(",");
const EMAIL_TABLE_STYLE = "border-collapse:collapse;width:100%;margin:12px 0;";
const EMAIL_TH_STYLE =
  "border:1px solid #d0d7de;padding:6px 8px;text-align:left;font-weight:bold;background:#f6f8fa;";
const EMAIL_TD_STYLE = "border:1px solid #d0d7de;padding:6px 8px;text-align:left;";

export type MessageTarget = "email-html" | "plain-text" | "slack";

export type SlackTextObject = {
  text: string;
  type: "mrkdwn" | "plain_text";
};

export type SlackTextStyle = { bold?: boolean; italic?: boolean; strike?: boolean };

export type SlackSectionBlock = {
  text: SlackTextObject;
  type: "section";
};

export type SlackRichTextElement =
  | { channel_id: string; type: "channel" }
  | { style?: SlackTextStyle; text: string; type: "text" }
  | { text?: string; type: "link"; url: string }
  | { type: "user"; user_id: string };

export type SlackRichTextSection = {
  elements: SlackRichTextElement[];
  type: "rich_text_section";
};

export type SlackRichTextList = {
  elements: SlackRichTextSection[];
  indent?: number;
  style: "bullet";
  type: "rich_text_list";
};

export type SlackRichTextBlock = {
  elements: Array<SlackRichTextSection | SlackRichTextList>;
  type: "rich_text";
};

export type SlackTableCell =
  | { text: string; type: "raw_text" }
  | {
      elements: SlackRichTextSection[];
      type: "rich_text";
    };

export type SlackTableBlock = {
  column_settings?: Array<{ is_wrapped?: boolean } | null>;
  rows: SlackTableCell[][];
  type: "table";
};

export type SlackBlock = SlackRichTextBlock | SlackSectionBlock | SlackTableBlock;

export type SlackMessagePayload = {
  blocks?: SlackBlock[];
  text: string;
};

export type RenderedMessage =
  | { kind: "html"; html: string; target: "email-html" }
  | { kind: "text"; target: "plain-text" | "slack"; text: string };

type InlineNode =
  | { type: "bold"; children: InlineNode[] }
  | { type: "italic"; children: InlineNode[] }
  | { type: "link"; children: InlineNode[]; url: string }
  | { type: "strikethrough"; children: InlineNode[] }
  | { type: "text"; value: string };

type MessageBlock =
  | { type: "blank" }
  | { type: "bullet"; children: InlineNode[]; indent: string }
  | { type: "heading"; children: InlineNode[] }
  | { type: "paragraph"; children: InlineNode[] }
  | { rows: InlineNode[][][]; type: "table" };

type TagToken = {
  full: string;
  name: string;
  attrs: string;
  isClosing: boolean;
  isSelfClosing: boolean;
};

function normalizeBodyNewlines(input: string): string {
  return input
    .replaceAll("\\r\\n", "\n")
    .replaceAll("\\n", "\n")
    .replaceAll("\\r", "\n")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeSlackText(input: string): string {
  let result = "";
  let index = 0;

  while (index < input.length) {
    const char = input[index];
    if (char === "<") {
      const tokenEnd = input.indexOf(">", index + 1);
      const token = tokenEnd === -1 ? "" : input.slice(index + 1, tokenEnd);
      if (tokenEnd !== -1 && isSlackToken(token)) {
        result += `<${token.replaceAll("&", "&amp;")}>`;
        index = tokenEnd + 1;
        continue;
      }
      result += "&lt;";
      index += 1;
      continue;
    }

    if (char === ">") {
      result += "&gt;";
      index += 1;
      continue;
    }

    if (char === "&") {
      result += "&amp;";
      index += 1;
      continue;
    }

    result += char;
    index += 1;
  }

  return result;
}

function isSlackToken(input: string): boolean {
  return (
    /^@[A-Z0-9][A-Z0-9._-]*$/.test(input) ||
    /^#[A-Z0-9][A-Z0-9._-]*(\|[^>]*)?$/.test(input) ||
    /^![a-zA-Z][^>]*$/.test(input) ||
    /^(https?:\/\/|mailto:)[^>\s|]+(\|[^>]*)?$/.test(input)
  );
}

function sanitizeSlackUrl(input: string): string {
  return input.replace(/[<>|]/g, "");
}

function parseInline(input: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let textStart = 0;
  let index = 0;

  function flushText(until: number) {
    if (until > textStart) {
      nodes.push({ type: "text", value: input.slice(textStart, until) });
    }
  }

  while (index < input.length) {
    if (input[index] === "[") {
      const labelEnd = input.indexOf("](", index + 1);
      if (labelEnd !== -1) {
        const urlEnd = input.indexOf(")", labelEnd + 2);
        const url = urlEnd === -1 ? "" : input.slice(labelEnd + 2, urlEnd);
        if (urlEnd !== -1 && /^https?:\/\/\S+$/i.test(url)) {
          flushText(index);
          nodes.push({
            type: "link",
            children: parseInline(input.slice(index + 1, labelEnd)),
            url,
          });
          index = urlEnd + 1;
          textStart = index;
          continue;
        }
      }
    }

    if (input.startsWith("**", index)) {
      const end = input.indexOf("**", index + 2);
      if (end !== -1) {
        flushText(index);
        nodes.push({ type: "bold", children: parseInline(input.slice(index + 2, end)) });
        index = end + 2;
        textStart = index;
        continue;
      }
    }

    if (input.startsWith("~~", index)) {
      const end = input.indexOf("~~", index + 2);
      if (end !== -1) {
        flushText(index);
        nodes.push({
          type: "strikethrough",
          children: parseInline(input.slice(index + 2, end)),
        });
        index = end + 2;
        textStart = index;
        continue;
      }
    }

    if (input[index] === "*") {
      const end = input.indexOf("*", index + 1);
      if (end !== -1) {
        flushText(index);
        nodes.push({ type: "italic", children: parseInline(input.slice(index + 1, end)) });
        index = end + 1;
        textStart = index;
        continue;
      }
    }

    if (input[index] === "_") {
      const end = input.indexOf("_", index + 1);
      if (end !== -1) {
        flushText(index);
        nodes.push({ type: "italic", children: parseInline(input.slice(index + 1, end)) });
        index = end + 1;
        textStart = index;
        continue;
      }
    }

    index += 1;
  }

  flushText(input.length);
  return nodes;
}

function isMarkdownTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) {
    return false;
  }
  const cells = splitMarkdownTableLine(trimmed);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitMarkdownTableLine(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith("|")) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.split("|").map((cell) => cell.trim());
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
  const line = lines[index] || "";
  const next = lines[index + 1] || "";
  return line.includes("|") && isMarkdownTableSeparator(next);
}

function isMarkdownTableRow(line: string): boolean {
  return line.trim().includes("|") && !isMarkdownTableSeparator(line);
}

export function parseMessageMarkdown(input: string): MessageBlock[] {
  const lines = normalizeBodyNewlines(input).split("\n");
  const blocks: MessageBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || "";

    if (isMarkdownTableStart(lines, index)) {
      const rows: InlineNode[][][] = [splitMarkdownTableLine(line).map(parseInline)];
      index += 2;
      while (index < lines.length && isMarkdownTableRow(lines[index] || "")) {
        rows.push(splitMarkdownTableLine(lines[index] || "").map(parseInline));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "table", rows });
      continue;
    }

    if (line.length === 0) {
      blocks.push({ type: "blank" });
      continue;
    }

    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push({ type: "heading", children: parseInline(heading[1] || "") });
      continue;
    }

    const bullet = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (bullet) {
      blocks.push({
        type: "bullet",
        indent: bullet[1] || "",
        children: parseInline(bullet[2] || ""),
      });
      continue;
    }

    blocks.push({ type: "paragraph", children: parseInline(line) });
  }

  return blocks;
}

function renderInlineEmail(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "bold":
          return `<strong>${renderInlineEmail(node.children)}</strong>`;
        case "italic":
          return `<em>${renderInlineEmail(node.children)}</em>`;
        case "link":
          return `<a href="${escapeHtml(sanitizeSlackUrl(node.url))}">${renderInlineEmail(
            node.children,
          )}</a>`;
        case "strikethrough":
          return `<s>${renderInlineEmail(node.children)}</s>`;
        case "text":
          return escapeHtml(node.value);
      }
    })
    .join("");
}

function renderInlinePlainText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "bold":
        case "italic":
          return renderInlinePlainText(node.children);
        case "link":
          return `${renderInlinePlainText(node.children)} (${node.url})`;
        case "strikethrough":
          return renderInlinePlainText(node.children);
        case "text":
          return node.value;
      }
    })
    .join("");
}

function renderInlineSlack(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case "bold":
          return `*${renderInlineSlack(node.children)}*`;
        case "italic":
          return `_${renderInlineSlack(node.children)}_`;
        case "link":
          return `<${sanitizeSlackUrl(node.url)}|${renderInlineSlack(node.children)}>`;
        case "strikethrough":
          return `~${renderInlineSlack(node.children)}~`;
        case "text":
          return escapeSlackText(node.value);
      }
    })
    .join("");
}

function renderBlocks(
  blocks: MessageBlock[],
  renderInline: (nodes: InlineNode[]) => string,
  lineBreak: string,
): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "blank":
          return "";
        case "bullet":
          return `${block.indent}- ${renderInline(block.children)}`;
        case "heading":
          return renderInline([{ type: "bold", children: block.children }]);
        case "paragraph":
          return renderInline(block.children);
        case "table":
          return block.rows
            .map((row) => `| ${row.map((cell) => renderInline(cell)).join(" | ")} |`)
            .join(lineBreak);
      }
    })
    .join(lineBreak);
}

function renderBlocksEmail(blocks: MessageBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "blank":
          return "";
        case "bullet":
          return `${block.indent}- ${renderInlineEmail(block.children)}`;
        case "heading":
          return `<strong>${renderInlineEmail(block.children)}</strong>`;
        case "paragraph":
          return renderInlineEmail(block.children);
        case "table":
          return [
            `<table style="${EMAIL_TABLE_STYLE}">`,
            ...block.rows.map((row, rowIndex) => {
              const tag = rowIndex === 0 ? "th" : "td";
              const style = rowIndex === 0 ? EMAIL_TH_STYLE : EMAIL_TD_STYLE;
              return `<tr>${row
                .map((cell) => `<${tag} style="${style}">${renderInlineEmail(cell)}</${tag}>`)
                .join("")}</tr>`;
            }),
            "</table>",
          ].join("");
      }
    })
    .join("<br>");
}

function extractHtmlTags(input: string): TagToken[] {
  const tags: TagToken[] = [];
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;

  for (const match of input.matchAll(tagRegex)) {
    const full = match[0];
    const name = (match[1] || "").toLowerCase();
    const attrs = match[2] || "";
    tags.push({
      full,
      name,
      attrs,
      isClosing: full.startsWith("</"),
      isSelfClosing: full.endsWith("/>"),
    });
  }

  return tags;
}

function throwInvalidEmailHtml(reason: string): never {
  throw new Error(
    `Invalid email body HTML: ${reason}. Allowed tags: ${ALLOWED_EMAIL_HTML_TAGS_TEXT}`,
  );
}

function validateAllowedEmailHtml(input: string, tags: TagToken[]): void {
  const withoutTags = input.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, "");
  if (/[<>]/.test(withoutTags)) {
    throwInvalidEmailHtml("malformed HTML tag");
  }

  const stack: string[] = [];
  for (const tag of tags) {
    if (!ALLOWED_EMAIL_HTML_TAG_SET.has(tag.name)) {
      throwInvalidEmailHtml(`unsupported tag <${tag.name}>`);
    }

    const attrText = tag.attrs.trim();
    if (tag.isClosing) {
      if (attrText.length > 0) {
        throwInvalidEmailHtml(`attributes are not allowed on </${tag.name}>`);
      }
      if (tag.name === "br") {
        throwInvalidEmailHtml("closing </br> tag is not allowed");
      }
      const open = stack.pop();
      if (open !== tag.name) {
        throwInvalidEmailHtml(`malformed closing tag </${tag.name}>`);
      }
      continue;
    }

    if (attrText.length > 0 && attrText !== "/") {
      throwInvalidEmailHtml(`attributes are not allowed on <${tag.name}>`);
    }
    if (tag.isSelfClosing && tag.name !== "br") {
      throwInvalidEmailHtml(`self-closing <${tag.name}/> tag is not allowed`);
    }
    if (tag.name !== "br") {
      stack.push(tag.name);
    }
  }

  if (stack.length > 0) {
    throwInvalidEmailHtml(`unclosed <${stack[stack.length - 1]}> tag`);
  }
}

export function renderMessageToEmailHtml(input: string): string {
  if (typeof input !== "string") {
    throwInvalidEmailHtml("body must be a string");
  }

  if (input.includes("<!--") || input.includes("-->")) {
    throwInvalidEmailHtml("HTML comments are not allowed");
  }

  if (/<\s*\/?\s*(script|style)\b/i.test(input)) {
    throwInvalidEmailHtml("script/style tags are not allowed");
  }

  const normalizedInput = normalizeBodyNewlines(input);
  const tags = extractHtmlTags(normalizedInput);
  if (tags.length > 0) {
    validateAllowedEmailHtml(normalizedInput, tags);
    return normalizedInput.replaceAll("\n", "<br>");
  }

  return renderBlocksEmail(parseMessageMarkdown(normalizedInput));
}

export function renderMessageToPlainText(input: string): string {
  return renderBlocks(parseMessageMarkdown(input), renderInlinePlainText, "\n");
}

export function renderMessageToSlack(input: string): string {
  return renderBlocks(parseMessageMarkdown(input), renderInlineSlack, "\n");
}

function renderInlineSlackRichText(nodes: InlineNode[], style: SlackTextStyle = {}) {
  return nodes.flatMap((node): SlackRichTextElement[] => {
    switch (node.type) {
      case "bold":
        return renderInlineSlackRichText(node.children, { ...style, bold: true });
      case "italic":
        return renderInlineSlackRichText(node.children, { ...style, italic: true });
      case "strikethrough":
        return renderInlineSlackRichText(node.children, { ...style, strike: true });
      case "link":
        return [
          {
            text: renderInlinePlainText(node.children),
            type: "link",
            url: sanitizeSlackUrl(node.url),
          },
        ];
      case "text":
        return renderSlackTextToRichTextElements(node.value, style);
    }
  });
}

function isEmptyStyle(style: SlackTextStyle): boolean {
  return !style || Object.keys(style).length === 0;
}

function renderSlackTextToRichTextElements(
  input: string,
  style: SlackTextStyle = {},
): SlackRichTextElement[] {
  const elements: SlackRichTextElement[] = [];
  const tokenRegex = /<([^>]+)>/g;
  let offset = 0;

  function pushText(value: string) {
    if (value.length === 0) {
      return;
    }
    elements.push(
      isEmptyStyle(style) ? { type: "text", text: value } : { type: "text", text: value, style },
    );
  }

  for (const match of input.matchAll(tokenRegex)) {
    const matchIndex = match.index ?? 0;
    pushText(input.slice(offset, matchIndex));

    const token = match[1] || "";
    const richToken = renderSlackTokenToRichTextElement(token);
    if (richToken) {
      elements.push(richToken);
    } else {
      pushText(match[0]);
    }

    offset = matchIndex + match[0].length;
  }

  pushText(input.slice(offset));
  return elements;
}

function renderSlackTokenToRichTextElement(token: string): SlackRichTextElement | null {
  const user = token.match(/^@([A-Z0-9][A-Z0-9._-]*)$/);
  if (user) {
    return { type: "user", user_id: user[1] || "" };
  }

  const channel = token.match(/^#([A-Z0-9][A-Z0-9._-]*)(?:\|[^>]*)?$/);
  if (channel) {
    return { type: "channel", channel_id: channel[1] || "" };
  }

  const link = token.match(/^((?:https?:\/\/|mailto:)[^>\s|]+)(?:\|([^>]*))?$/);
  if (link) {
    return {
      type: "link",
      url: sanitizeSlackUrl(link[1] || ""),
      ...(link[2] ? { text: link[2] } : {}),
    };
  }

  return null;
}

function renderSlackTableCell(nodes: InlineNode[]): SlackTableCell {
  const elements = renderInlineSlackRichText(nodes).filter((element) =>
    "text" in element ? (element.text ?? "").length > 0 : true,
  );
  if (elements.length === 0) {
    return { type: "raw_text", text: "" };
  }
  return {
    type: "rich_text",
    elements: [{ type: "rich_text_section", elements }],
  };
}

function hasSlackBlockFormatting(blocks: MessageBlock[]): boolean {
  return blocks.some((block) => block.type === "bullet" || block.type === "table");
}

function bulletIndentLevel(indent: string): number {
  return Math.floor(indent.replace(/\t/g, "  ").length / 2);
}

function renderSlackRichTextSection(nodes: InlineNode[]): SlackRichTextSection {
  const elements = renderInlineSlackRichText(nodes);
  return {
    type: "rich_text_section",
    elements: elements.length > 0 ? elements : [{ type: "text", text: "" }],
  };
}

function renderSlackRichTextBlock(blocks: MessageBlock[]): SlackRichTextBlock | null {
  const elements: Array<SlackRichTextSection | SlackRichTextList> = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) {
      continue;
    }

    switch (block.type) {
      case "blank":
        elements.push({ type: "rich_text_section", elements: [{ type: "text", text: "\n" }] });
        break;
      case "heading":
        elements.push(
          renderSlackRichTextSection([{ type: "bold", children: block.children }]),
        );
        break;
      case "paragraph":
        elements.push(renderSlackRichTextSection(block.children));
        break;
      case "bullet": {
        const indent = bulletIndentLevel(block.indent);
        const listElements: SlackRichTextSection[] = [];
        while (index < blocks.length) {
          const current = blocks[index];
          if (current?.type !== "bullet" || bulletIndentLevel(current.indent) !== indent) {
            break;
          }
          listElements.push(renderSlackRichTextSection(current.children));
          index += 1;
        }
        index -= 1;
        elements.push({ type: "rich_text_list", style: "bullet", indent, elements: listElements });
        break;
      }
      case "table":
        elements.push({
          type: "rich_text_section",
          elements: [{ type: "text", text: renderBlocks([block], renderInlineSlack, "\n") }],
        });
        break;
    }
  }

  return elements.length > 0 ? { type: "rich_text", elements } : null;
}

function renderSlackBlocks(blocks: MessageBlock[]): SlackBlock[] {
  const slackBlocks: SlackBlock[] = [];
  let pending: MessageBlock[] = [];
  let hasTable = false;

  function flushPending() {
    while (pending[0]?.type === "blank") {
      pending = pending.slice(1);
    }
    while (pending[pending.length - 1]?.type === "blank") {
      pending = pending.slice(0, -1);
    }
    const richTextBlock = renderSlackRichTextBlock(pending);
    if (richTextBlock) {
      slackBlocks.push(richTextBlock);
    }
    pending = [];
  }

  for (const block of blocks) {
    if (block.type === "table" && !hasTable) {
      flushPending();
      hasTable = true;
      slackBlocks.push({
        type: "table",
        column_settings: block.rows[0]?.map(() => ({ is_wrapped: true })),
        rows: block.rows.slice(0, 100).map((row) => row.slice(0, 20).map(renderSlackTableCell)),
      });
      continue;
    }

    pending.push(block);
  }

  flushPending();
  return slackBlocks;
}

export function renderMessageToSlackPayload(input: string): SlackMessagePayload {
  const blocks = parseMessageMarkdown(input);
  const text = renderBlocks(blocks, renderInlineSlack, "\n");
  if (!hasSlackBlockFormatting(blocks)) {
    return { text };
  }

  return { text, blocks: renderSlackBlocks(blocks) };
}

export function renderMessage(input: string, target: MessageTarget): RenderedMessage {
  switch (target) {
    case "email-html":
      return { kind: "html", target, html: renderMessageToEmailHtml(input) };
    case "plain-text":
      return { kind: "text", target, text: renderMessageToPlainText(input) };
    case "slack":
      return { kind: "text", target, text: renderMessageToSlack(input) };
  }
}

export function prepareEmailHtmlBody(input: string): { html: string } {
  return { html: renderMessageToEmailHtml(input) };
}
