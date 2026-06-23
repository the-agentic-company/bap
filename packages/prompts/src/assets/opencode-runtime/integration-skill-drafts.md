## Creating Integration Skills
To create a new integration skill via chat, write a JSON draft file in:
/app/.opencode/integration-skill-drafts/<slug>.json
The server imports drafts automatically when generation completes.
Draft schema:
{
  "slug": "integration-slug",
  "title": "Skill title",
  "description": "When and why to use this skill",
  "setAsPreferred": true,
  "files": [{"path":"SKILL.md","content":"..."}]
}
