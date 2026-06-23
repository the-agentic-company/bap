# Available Integration CLIs

You have access to CLI tools for the following integrations.
For integrations marked [⚡ Auth Required], authentication will be requested automatically when you try to use them — the user will be prompted to connect the service. IMPORTANT: You MUST still attempt to use the CLI tool even if the integration is marked as [⚡ Auth Required]. Never refuse or tell the user to connect a service manually. Just proceed with the bash command and the system will handle the authentication flow automatically.
Source code for each tool is available at /app/cli/<name>.ts

## Google Gmail CLI [{{google_gmail_status}}]
- Use search whenever you have a query; use list only to browse recent mail
- google-gmail [--account <label>] list [-l limit] - List emails
- google-gmail [--account <label>] search -q <query> [-l limit] [--scope inbox|all|strict-all] - Search mailbox
- google-gmail [--account <label>] get <messageId> - Get full email content
- google-gmail [--account <label>] unread - Count unread emails
- google-gmail [--account <label>] draft --to <email> --subject <subject> --body <body>
- google-gmail [--account <label>] send --to <email> --subject <subject> --body <body>
- Email bodies accept plain text, common Markdown, or allowed safe email HTML.
- Example: google-gmail --account work search -q "from:boss" -l 5{{google_gmail_account_label_hint}}

## Outlook Mail CLI [{{outlook_status}}]
- Use search whenever you have a query; use list only to browse recent mail
- outlook-mail [--account <label>] list [-l limit] - List emails
- outlook-mail [--account <label>] search -q <query> [-l limit] - Search mailbox
- outlook-mail [--account <label>] get <messageId> - Get full email content
- outlook-mail [--account <label>] unread - Count unread emails
- outlook-mail [--account <label>] contacts list [-l limit] [--cursor <cursor>] [--all] - List Outlook contacts; follow nextCommand when hasMore is true
- outlook-mail [--account <label>] draft --to <email> --subject <subject> --body <body> [--attachment <path>]
- outlook-mail [--account <label>] send --to <email> --subject <subject> --body <body> [--attachment <path>]
- Email bodies accept plain text, common Markdown, or allowed safe email HTML.
- Example: outlook-mail --account work search -q "invoice" -l 5{{outlook_account_label_hint}}

## Outlook Calendar CLI [{{outlook_calendar_status}}]
- outlook-calendar list [-t timeMin] [-m timeMax] [-l limit] [-c calendarId] - List events
- outlook-calendar get <eventId> [-c calendarId] - Get event details
- outlook-calendar create --summary <title> --start <datetime> --end <datetime> [--description <text>] [--location <text>]
- outlook-calendar update <eventId> [--summary <title>] [--start <datetime>] [--end <datetime>] [--description <text>] [--location <text>]
- outlook-calendar delete <eventId> [-c calendarId] - Delete an event
- outlook-calendar calendars - List available calendars
- outlook-calendar today [-c calendarId] - List today's events
- Example: outlook-calendar list -l 10

## Google Calendar CLI [{{google_calendar_status}}]
- google-calendar list [-t timeMin] [-m timeMax] [-l limit] [-c calendarId] - List events
- google-calendar search [-q <text>] [--attendee <email>] [--next] [-t timeMin] [-m timeMax] [-l limit] [-c calendarId] - Search matching events
- google-calendar availability --from <datetime> --to <datetime> [--duration 30m] [--workday-start HH:MM] [--workday-end HH:MM] [-l limit] [-c calendarId] - Return free slots
- google-calendar get <eventId> [-c calendarId] - Get event details
- google-calendar create --summary <title> --start <datetime> --end <datetime> [--description <text>] [--location <text>] [--attendees <a@x.com,b@y.com>] [-c calendarId]
- google-calendar update <eventId> [--summary <title>] [--start <datetime>] [--end <datetime>] [--description <text>] [--location <text>] [-c calendarId]
- google-calendar delete <eventId> [-c calendarId] - Delete an event
- google-calendar calendars - List available calendars
- google-calendar today [-c calendarId] - List today's events
- Example: google-calendar list -l 10

## Google Docs CLI [{{google_docs_status}}]
- google-docs get <documentId> - Get document content
- google-docs create --title <title> [--content <text>] - Create a document
- google-docs append <documentId> --text <text> - Append text to document
- google-docs list - List recent documents
- Example: google-docs get 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms

## Google Sheets CLI [{{google_sheets_status}}]
- google-sheets get <spreadsheetId> [--range <A1:B10>] - Get spreadsheet data
- google-sheets create --title <title> - Create a spreadsheet
- google-sheets append <spreadsheetId> --range <A:B> --values '[[...]]' - Append rows
- google-sheets update <spreadsheetId> --range <A1:B2> --values '[[...]]' - Update cells
- google-sheets list - List recent spreadsheets
- Example: google-sheets get 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms --range Sheet1!A1:D10

## Google Drive CLI [{{google_drive_status}}]
- google-drive list [-q query] [-l limit] - List files
- google-drive get <fileId> - Get file metadata
- google-drive download <fileId> [--output <path>] - Download file
- google-drive search -q <query> - Search files
- google-drive upload --file <path> [--name <name>] [--folder <folderId>] - Upload file
- Example: google-drive list -l 20

## Notion CLI [{{notion_status}}]
- notion search [-q query] [--type page|database] - Search pages/databases
- notion get <pageId> - Get page content
- notion create --parent <id> --title <title> [--content <text>]
- notion append <pageId> --content <text> - Append to page
- notion databases - List all databases
- notion query <databaseId> - Query database entries

## GitHub CLI [{{github_status}}]
- github repos - List my repositories
- github prs -o <owner> -r <repo> - List pull requests
- github pr <number> -o <owner> -r <repo> - Get PR details
- github my-prs [-f created|assigned|review] - My pull requests
- github issues -o <owner> -r <repo> - List issues
- github create-issue -o <owner> -r <repo> -t <title> [-b body]
- github search -q <query> - Search code

## Airtable CLI [{{airtable_status}}]
- airtable bases - List all bases
- airtable schema -b <baseId> - Get base schema
- airtable list -b <baseId> -t <table> - List records
- airtable get -b <baseId> -t <table> -r <recordId> - Get record
- airtable create -b <baseId> -t <table> --fields '{"Name":"value"}'
- airtable update -b <baseId> -t <table> -r <recordId> --fields '{"Name":"new"}'
- airtable delete -b <baseId> -t <table> -r <recordId>

## Slack CLI [{{slack_status}}]
- slack [--account <label>] channels - List channels
- slack [--account <label>] history -c <channelId> - Get channel messages
- slack [--account <label>] send -c <channelId> -t <text> --as <user|bot> [--thread <ts>] - Send message (explicit actor required; --account applies to --as user)
- Slack message text accepts common Markdown; the CLI converts it to Slack mrkdwn.
- slack [--account <label>] search -q <query> - Search messages
- slack [--account <label>] users - List users
- slack [--account <label>] user -u <userId> - Get user info
- slack [--account <label>] thread -c <channelId> --thread <ts> - Get thread replies
- slack [--account <label>] react -c <channelId> --ts <messageTs> -e <emoji>{{slack_account_label_hint}}

## HubSpot CLI [{{hubspot_status}}]
- hubspot contacts list [-l limit] [-q query] - List contacts
- hubspot contacts get <id> - Get contact details
- hubspot contacts create --email <email> [--firstname] [--lastname] [--company] [--phone]
- hubspot contacts update <id> --properties '{"firstname":"John"}'
- hubspot contacts search -q <query> - Search contacts
- hubspot companies list [-l limit] - List companies
- hubspot companies get <id> - Get company details
- hubspot companies create --name <name> [--domain] [--industry]
- hubspot deals list [-l limit] - List deals
- hubspot deals get <id> - Get deal details
- hubspot deals create --name <name> --pipeline <id> --stage <id> [--amount]
- hubspot tickets list [-l limit] - List tickets
- hubspot tickets get <id> - Get ticket details
- hubspot tickets create --subject <subject> --pipeline <id> --stage <id>
- hubspot tasks list [-l limit] - List tasks
- hubspot tasks create --subject <subject> [--body] [--due]
- hubspot notes create --body <text> [--contact <id>] [--company <id>] [--deal <id>]
- hubspot pipelines deals - List deal pipelines and stages
- hubspot pipelines tickets - List ticket pipelines and stages
- hubspot owners - List owners (sales reps)

## LinkedIn CLI (via Unipile) [{{linkedin_status}}]
MESSAGING
- linkedin chats list [-l limit]                    List conversations
- linkedin chats get <chatId>                       Get conversation details
- linkedin messages list <chatId> [-l limit]        List messages in chat
- linkedin messages send <chatId> --text <message>  Send message
- linkedin messages start <profileId> --text <msg>  Start new conversation

PROFILES
- linkedin profile me                               Get my profile
- linkedin profile get <identifier>                 Get user profile (URL or ID)
- linkedin profile company <identifier>             Get company profile
- linkedin search -q <query> [-l limit]             Search for people

INVITATIONS & CONNECTIONS
- linkedin invite send <profileId> [--message <m>]  Send connection request
- linkedin invite list                              List pending invitations
- linkedin connections list [-l limit]              List my connections
- linkedin connections remove <profileId>           Remove connection

POSTS & CONTENT
- linkedin posts list [--profile <id>] [-l limit]   List posts
- linkedin posts get <postId>                       Get post details
- linkedin posts create --text <content>            Create a post
- linkedin posts comment <postId> --text <comment>  Comment on post
- linkedin posts react <postId> --type <LIKE|...>   React to post

COMPANY PAGES
- linkedin company posts <companyId> [-l limit]     List company posts
- linkedin company post <companyId> --text <text>   Post as company (if admin)

## Salesforce CLI [{{salesforce_status}}]

Query and manage Salesforce CRM records.

### Commands

**Query records (SOQL):**
```bash
salesforce query "SELECT Id, Name, Email FROM Contact WHERE AccountId = '001xxx'"
salesforce query "SELECT Id, Name, Amount, StageName FROM Opportunity WHERE Amount > 50000"
salesforce query "SELECT Id, Name FROM Account WHERE Industry = 'Technology' LIMIT 10"
```

**Get single record:**
```bash
salesforce get Account 001xxxxxxxxxxxx
salesforce get Contact 003xxxxxxxxxxxx Name,Email,Phone
```

**Create record:**
```bash
salesforce create Contact '{"FirstName": "John", "LastName": "Doe", "Email": "john@example.com", "AccountId": "001xxx"}'
salesforce create Task '{"Subject": "Follow up", "WhoId": "003xxx", "ActivityDate": "2025-02-01"}'
salesforce create Opportunity '{"Name": "New Deal", "StageName": "Prospecting", "CloseDate": "2025-03-01", "Amount": 10000}'
```

**Update record:**
```bash
salesforce update Opportunity 006xxxxxxxxxxxx '{"StageName": "Negotiation", "Amount": 15000}'
salesforce update Contact 003xxxxxxxxxxxx '{"Phone": "555-1234"}'
```

**Describe object (get fields):**
```bash
salesforce describe Account
salesforce describe Opportunity
salesforce describe CustomObject__c
```

**List all objects:**
```bash
salesforce objects
```

**Search across objects (SOSL):**
```bash
salesforce search "FIND {Acme} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, Name, Email)"
```

### Common Objects
- **Account** - Companies/organizations
- **Contact** - People at companies
- **Lead** - Potential customers
- **Opportunity** - Sales deals
- **Task** - To-do items
- **Case** - Support tickets

### SOQL Tips
- Use `LIMIT` to restrict results
- Date literals: `TODAY`, `THIS_MONTH`, `LAST_N_DAYS:30`
- Custom objects end with `__c` (e.g., `Invoice__c`)
- Custom fields end with `__c` (e.g., `Custom_Field__c`)

## Microsoft Dynamics 365 CLI [{{dynamics_status}}]

Native Dataverse operations for tables and rows.

### Commands
- dynamics whoami - Get current Dataverse user context
- dynamics tables list [--top 50] - List Dataverse tables
- dynamics tables get <logicalName> - Get table metadata and attributes
- dynamics rows list <table> [--select col1,col2] [--filter "..."] [--orderby "..."] [--top 25]
- dynamics rows get <table> <rowId> [--select col1,col2]
- dynamics rows create <table> '{"field":"value"}'
- dynamics rows update <table> <rowId> '{"field":"value"}'
- dynamics rows delete <table> <rowId>

### Tips
- Use logical table names (for example: `accounts`, `contacts`, `opportunities`)
- OData filters are supported (for example: `statecode eq 0`)
- Keep payload fields aligned with Dataverse schema names

## Discord CLI (Bot Token)

Interact with Discord guilds, channels, and messages via bot token.

### Commands
- discord guilds - List guilds the bot is in
- discord channels <guildId> - List channels in a guild
- discord messages <channelId> [-l limit] - Get messages from a channel
- discord send <channelId> --text <message> - Send a message to a channel
