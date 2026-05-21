---
name: outlook
description: Read, search, draft, and send Outlook emails, and look up or list Outlook contacts. Use for listing emails, searching the mailbox, reading content, counting unread, finding contacts, listing contacts, drafting messages, and sending messages.
---

# Outlook Mail

Read inbox emails, get email content, count unread emails, find people contacts, list Outlook contacts, draft messages, and send messages via Microsoft Graph.

## Environment Variables

- `OUTLOOK_ACCESS_TOKEN` - Fallback Microsoft OAuth2 access token with Outlook Mail and People scopes, including draft creation and contact lookup support
- `CMDCLAW_RUNTIME_CREDENTIALS_URL` and `CMDCLAW_USER_ID` - Resolve a selected Connected Account when `--account <label>` is used

## Commands

```bash
# List emails
outlook-mail [--account <label>] list [-l limit]

# Search mailbox
outlook-mail [--account <label>] search -q "subject keyword" [-l limit]

# Get full email content
outlook-mail [--account <label>] get <messageId>

# Count unread emails
outlook-mail [--account <label>] unread [-q "subject keyword"] [-l limit]

# Find a person/contact by name or email using Outlook People search
outlook-mail [--account <label>] contact -q "Jane Doe" [-l limit]

# List Outlook contacts with cursor pagination
outlook-mail [--account <label>] contacts list [-l limit] [--cursor <cursor>] [--all]

# Draft an email
outlook-mail [--account <label>] draft --to "user@example.com" --subject "Hello" --body "Message text" [--cc "cc@example.com"] [--attachment /tmp/report.pdf]

# Send an email
outlook-mail [--account <label>] send --to "user@example.com" --subject "Hello" --body "Message text" [--cc "cc@example.com"] [--attachment /tmp/report.pdf]
```

## Email Body Formatting

- Email body is sent as HTML.
- Allowed tags: `<b>`, `<strong>`, `<s>`, `<i>`, `<em>`, `<u>`, `<br>`, `<p>`, `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`.
- Unsupported tags cause command failure.
- Only safe formatter-managed table attributes are allowed.
- Plain text bodies can use common Markdown for headings, bullets, bold, italic, strikethrough, links, and tables. The CLI converts those into safe email HTML.

## Output Format

JSON arrays/objects for read operations. `outlook-mail contacts list` returns `contacts`, `count`, `hasMore`, and when more contacts exist, `nextCursor` plus the exact `nextCommand` to fetch the next page. Use `--all` only when the user explicitly needs every contact.
