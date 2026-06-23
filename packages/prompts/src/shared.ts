export function replacePlaceholder(template: string, placeholder: string, value: string): string {
  return template.replaceAll(`{{${placeholder}}}`, value);
}

export function replacePlaceholders(template: string, values: Record<string, string>): string {
  let rendered = template;
  for (const [placeholder, value] of Object.entries(values)) {
    rendered = replacePlaceholder(rendered, placeholder, value);
  }
  return rendered;
}
