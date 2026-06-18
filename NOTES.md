# Notes

- User wants vocabulary first, not implementation first.
- The motivating design problem is user grouping in the app: companies may have departments, teams, shared workspaces, admins, guests, and cross-functional groups.
- Keep future lessons concrete and compare against familiar tools such as Linear, Notion, Slack, GitHub, Google Workspace, and Figma.
- Bap team feature is now being discussed enterprise-first: customers may have multiple flexible teams/groups inside one organization.
- Main shared Bap objects appear to be coworkers/agents and skills. Conversations stay private by default but can be shared.
- User is not prioritizing action approvals yet; individual approval can remain personal. The near-term concern is who can create/edit/access agents, skills, and tool access.
- Teams/groups in Bap should be flexible rather than strict departments: Engineering, Reliability, Support, approvers, or other temporary/cross-functional sets.
- Memory is not fully implemented yet. Long term, expect company-wide memory plus personal memory, with possible coworker/team context later.
- Do not spend more time on the user-facing "agent" versus "coworker" naming for now; the user wants structure and behavior first.
- Current access assumption: only admins/editors create or edit agents. In the near term, everyone may effectively be admin/editor; later there can be ordinary users.
- Skills need at least two sharing scopes: organization-wide and team-specific, because departments may create skills with colliding names.
- Tool connections are likely organization-wide when enabled, then made available through access grants rather than reconnected per team.
- Shared agent chats/runs should probably behave like Google Docs history: team members can see who triggered runs and read the history, with editing controlled separately.
- Current teaching focus: shareable coworkers should be modeled as several separable objects, not one public/private flag. At minimum distinguish coworker definition access, run/invocation access, run history visibility, public preview/output links, copy/remix, and tool/credential grants.
