export type ParsedSkillContent = {
  name: string;
  description: string;
  body: string;
  frontmatter: string;
};

const ALLOWED_TOOL_INTEGRATION_MAP: Record<string, string> = {
  "agent-browser": "agent-browser",
  coworker: "coworker",
  slack: "slack",
  "google-gmail": "google_gmail",
  "outlook-mail": "outlook",
  "outlook-calendar": "outlook_calendar",
  "google-calendar": "google_calendar",
  "google-docs": "google_docs",
  "google-sheets": "google_sheets",
  "google-drive": "google_drive",
  notion: "notion",
  github: "github",
  airtable: "airtable",
  hubspot: "hubspot",
  linkedin: "linkedin",
  salesforce: "salesforce",
  dynamics: "dynamics",
};

type ParsedFrontmatterField = {
  start: number;
  end: number;
  value: string;
};

function splitSkillContent(content: string): { frontmatter: string; body: string } | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!frontmatterMatch) {
    return null;
  }

  return {
    frontmatter: frontmatterMatch[1],
    body: frontmatterMatch[2],
  };
}

function unquoteYamlValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function foldYamlLines(lines: string[]): string {
  const folded: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    folded.push(paragraph.join(" "));
    paragraph = [];
  };

  for (const line of lines) {
    if (line === "") {
      flushParagraph();
      folded.push("");
      continue;
    }
    paragraph.push(line);
  }

  flushParagraph();
  return folded.join("\n");
}

function parseBlockScalar(
  lines: string[],
  startIndex: number,
  indicator: string,
): { value: string; end: number } {
  let end = startIndex + 1;
  const blockLines: string[] = [];

  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() !== "" && !/^[\t ]/.test(line)) {
      break;
    }
    blockLines.push(line);
    end += 1;
  }

  const nonEmptyLines = blockLines.filter((line) => line.trim() !== "");
  const minIndent =
    nonEmptyLines.length === 0
      ? 0
      : Math.min(...nonEmptyLines.map((line) => line.match(/^[\t ]*/)![0].length));

  const normalizedLines = blockLines.map((line) => {
    if (line.trim() === "") {
      return "";
    }
    return line.slice(minIndent);
  });

  const rawValue = indicator.startsWith(">")
    ? foldYamlLines(normalizedLines)
    : normalizedLines.join("\n");

  return {
    value: rawValue.replace(/\n+$/g, ""),
    end,
  };
}

function parseFrontmatterField(frontmatter: string, key: string): ParsedFrontmatterField | null {
  const lines = frontmatter.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[\t ]/.test(line)) {
      continue;
    }

    const match = line.match(new RegExp(`^${key}:\\s*(.*)$`));
    if (!match) {
      continue;
    }

    const rawValue = match[1] ?? "";
    const trimmedValue = rawValue.trim();
    if (/^[>|][+-]?$/.test(trimmedValue)) {
      const block = parseBlockScalar(lines, index, trimmedValue);
      return {
        start: index,
        end: block.end,
        value: block.value,
      };
    }

    return {
      start: index,
      end: index + 1,
      value: unquoteYamlValue(rawValue),
    };
  }

  return null;
}

function formatYamlScalar(value: string): string {
  if (value.length === 0) {
    return '""';
  }

  if (/^[a-z0-9][a-z0-9\-_. /()]*$/i.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function formatFrontmatterField(key: string, value: string): string[] {
  if (value.includes("\n")) {
    return [`${key}: |`, ...value.split("\n").map((line) => `  ${line}`)];
  }

  return [`${key}: ${formatYamlScalar(value)}`];
}

function replaceFrontmatterField(frontmatter: string, key: string, value: string): string {
  const lines = frontmatter.length > 0 ? frontmatter.split("\n") : [];
  const existingField = parseFrontmatterField(frontmatter, key);
  const replacementLines = formatFrontmatterField(key, value);

  if (existingField) {
    lines.splice(existingField.start, existingField.end - existingField.start, ...replacementLines);
    return lines.join("\n");
  }

  return [...lines, ...replacementLines]
    .filter((line, index, all) => !(index === 0 && line === "" && all.length > 1))
    .join("\n");
}

function parseFrontmatterListField(frontmatter: string, key: string): string[] {
  const lines = frontmatter.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[\t ]/.test(line)) {
      continue;
    }

    const match = line.match(new RegExp(`^${key}:\\s*(.*)$`));
    if (!match) {
      continue;
    }

    const rawValue = match[1] ?? "";
    const trimmedValue = rawValue.trim();
    if (trimmedValue.length > 0) {
      return [unquoteYamlValue(trimmedValue)].filter(Boolean);
    }

    const values: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const entry = lines[cursor];
      if (entry.trim() !== "" && !/^[\t ]/.test(entry)) {
        break;
      }

      const itemMatch = entry.trim().match(/^-\s*(.+)$/);
      if (itemMatch?.[1]) {
        values.push(unquoteYamlValue(itemMatch[1]));
      }
      cursor += 1;
    }

    return values;
  }

  return [];
}

function parseAllowedToolIntegrationEntry(entry: string): string | null {
  const bashMatch = entry.trim().match(/^Bash\(([^):]+)(?::[^)]*)?\)$/i);
  if (bashMatch?.[1]) {
    return ALLOWED_TOOL_INTEGRATION_MAP[bashMatch[1].toLowerCase()] ?? null;
  }

  return ALLOWED_TOOL_INTEGRATION_MAP[entry.trim().toLowerCase()] ?? null;
}

export function parseSkillContent(content: string): ParsedSkillContent {
  const splitContent = splitSkillContent(content);

  if (!splitContent) {
    return { name: "", description: "", body: content, frontmatter: "" };
  }

  const { frontmatter, body } = splitContent;
  const nameField = parseFrontmatterField(frontmatter, "name");
  const descriptionField = parseFrontmatterField(frontmatter, "description");

  return {
    name: nameField?.value ?? "",
    description: descriptionField?.value ?? "",
    body: body.replace(/^\n/, ""),
    frontmatter,
  };
}

export function extractSkillToolIntegrations(content: string): string[] {
  const { frontmatter } = parseSkillContent(content);
  if (!frontmatter) {
    return [];
  }

  const seen = new Set<string>();
  const integrations: string[] = [];
  for (const entry of parseFrontmatterListField(frontmatter, "allowed-tools")) {
    const integration = parseAllowedToolIntegrationEntry(entry);
    if (!integration || seen.has(integration)) {
      continue;
    }
    seen.add(integration);
    integrations.push(integration);
  }

  return integrations;
}

export function serializeSkillContent(
  name: string,
  description: string,
  body: string,
  existingFrontmatter = "",
): string {
  let nextFrontmatter = existingFrontmatter.trimEnd();
  nextFrontmatter = replaceFrontmatterField(nextFrontmatter, "name", name);
  nextFrontmatter = replaceFrontmatterField(nextFrontmatter, "description", description);

  return body.length > 0
    ? `---\n${nextFrontmatter}\n---\n\n${body}`
    : `---\n${nextFrontmatter}\n---\n`;
}
