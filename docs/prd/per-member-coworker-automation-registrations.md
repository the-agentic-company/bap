# Per-member Coworker automation registrations

## Problem Statement

Shared Coworkers currently have a single automation owner. Scheduled runs therefore execute once, using one person's identity and Connected Accounts, even when several Workspace members want to use the same Coworker. This behaves like installing or copying a Coworker for an individual rather than sharing one canonical Coworker as people share a Google Doc or Notion page.

The model also creates unclear privacy and administration behavior. Workspace members need to see who ran a shared Coworker and whether each run succeeded, but they must not gain access to another member's inputs, conversation, tool results, output, private error details, or Connected Account choices. A Workspace administrator should be able to manage operational health without impersonating members or inspecting their private execution content.

Scheduled automation needs a durable model that can fan out one shared schedule to multiple consenting members, preserve each member's identity and credentials, isolate failures, and expose understandable history and billing impact. It must do this without requiring every possible Toolbox integration to be connected in advance and without changing the behavior of manual runs or forwarded-email triggers.

## Solution

Introduce an **Automation Registration** for a shared Coworker. Each eligible Workspace member can register themselves for that Coworker's shared schedule. At every scheduled occurrence, the system starts one private run for every active registration. Each run executes as the registered member and resolves only that member's Connected Accounts.

The Coworker remains a single shared resource. Its instructions, Toolbox, trigger configuration, approval behavior, inputs, and schedule are edited once and apply to every registration. In the initial model, any Workspace member who already has permission to edit the Coworker may edit those shared settings. Active registrations continue without another review or consent step after an edit. Editing the shared schedule also activates the editor's own registration because changing an automated schedule is treated as opting into that schedule.

Registration is self-service and identity-bound. A member uses the **Run this schedule for me** switch to register or unregister themselves; editing the schedule also registers them. No other person, including an administrator, may register or reactivate them. An administrator may pause or remove registrations for operational or security reasons. Losing Workspace membership revokes the registration, and rejoining does not reactivate it automatically.

The shared schedule produces one durable schedule occurrence. The dispatcher snapshots the active registrations for that occurrence and creates at most one child run for each registration. Retries are idempotent. Failures, backlog limits, and safety pauses are scoped to the affected registration so one member cannot stop scheduled runs for everyone else.

Run content is private to the registered member. Workspace-visible history exposes only safe operational metadata: the schedule occurrence, member name and avatar, run status, and timing. History groups child runs by occurrence. Selecting one's own child run opens its content; selecting another member's run explains that the content is private to the person who ran it.

Connected Account preferences are also private. A member may select an Account Label or compatible Connected Identity for an integration when several choices exist. The system does not require a registration-time preflight for every integration available to the Coworker. Account resolution happens when a tool is actually invoked: exactly one compatible identity may resolve automatically, a saved private choice may disambiguate multiple identities, and missing or ambiguous authorization fails only that member's run.

The existing automation owner who has valid consent migrates to the first active registration. No other members are enrolled automatically. If there is no eligible, consenting owner, the Coworker starts with no active registrations while retaining its shared schedule.

## User Stories

1. As a Workspace member, I can open a shared Coworker directly without installing or copying it so that everyone collaborates on one canonical Coworker.
2. As a Workspace member, I can tell whether a Coworker is private or shared with my Workspace so that its audience is clear at a glance.
3. As a Workspace member, I can see who created a shared Coworker, including their name and avatar, so that its origin is clear.
4. As a Workspace member with access, I can see that a scheduled Coworker supports registrations so that I understand how automated runs are created.
5. As a Workspace member with access, I can see every registered member's name, avatar, and operational status directly in the Schedule section.
6. As a Workspace member with access, I do not need to expand an accordion or interpret a separate automation banner to understand who the schedule runs for.
7. As an eligible Workspace member, I can see whether **Run this schedule for me** is on or off.
8. As an eligible Workspace member, I can turn **Run this schedule for me** on or off to register or unregister myself.
9. As an eligible Workspace member, I can register myself for a scheduled Coworker so that it runs for me at every shared occurrence.
10. As an eligible Workspace member, I cannot register another person so that nobody grants access to that person's identity or Connected Accounts without consent.
11. As a Workspace administrator, I cannot register or reactivate another member so that administrative authority does not become identity consent.
12. As a registered member, I can turn my schedule switch off without affecting the shared schedule or other members.
13. As an unregistered member, I can turn my schedule switch on so that future occurrences run for me.
14. As a Coworker editor, changing the shared schedule automatically registers me for it.
15. As a Workspace administrator, I can pause a member's registration for operational or security reasons without viewing that member's private run content.
16. As a Workspace administrator, I can remove a member's registration without registering or reactivating that person.
17. As a registered member, I retain my registration when another editor changes the shared Coworker so that routine collaboration does not create repeated consent prompts.
18. As a Coworker editor, I can update the shared schedule once and have the change apply to every registration.
19. As a Coworker editor, I can update shared instructions, Toolbox, trigger settings, approval behavior, and inputs once for all registered members.
20. As a registered member, I do not need to review or reapprove shared changes before my active registration continues.
21. As a registered member, I receive one run for each scheduled occurrence while my registration is active.
22. As a registered member, I do not receive duplicate runs when the scheduler or dispatcher retries the same occurrence.
23. As a registered member, my scheduled run executes as me rather than as the Coworker creator, an administrator, or another registrant.
24. As a registered member, my run uses only my Connected Accounts and Workspace MCP authorizations.
25. As a registered member, my run cannot fall back to another member's credentials when my own authorization is missing.
26. As a registered member with one compatible Connected Identity, I can have that identity resolved automatically when the relevant tool is invoked.
27. As a registered member with multiple compatible identities, I can privately choose an Account Label or identity to resolve the ambiguity.
28. As a registered member, my Connected Account choices are not visible to Coworker editors, Workspace administrators, or other registered members.
29. As a registered member, I can register without connecting every integration that the Coworker's Toolbox might potentially use.
30. As a registered member, I only encounter a missing or ambiguous authorization error if the run actually invokes the affected tool.
31. As a registered member, a missing or ambiguous authorization fails only my run and does not affect other registrations.
32. As a registered member, an ordinary failed run leaves my registration active so that the next scheduled occurrence can try again.
33. As a registered member, repeated blocked runs may safety-pause my registration so that an unresolvable personal backlog does not grow indefinitely.
34. As a safety-paused member, I can see that my registration is blocked and take action before resuming it.
35. As a registered member, another member's failed, blocked, or slow run does not pause or delay my registration.
36. As a Coworker editor, I can see aggregate registration health without seeing private failure details.
37. As a Workspace administrator, I can see which registrations are Active, Paused, or Blocked so that I can manage schedule health.
38. As a Workspace administrator, I can see a schedule-wide dispatch failure so that I can respond to infrastructure problems affecting everyone.
39. As a registered member, I am notified about my own completed, failed, or blocked runs according to my notification preferences.
40. As a registered member, I am not notified about another member's private run failure.
41. As a Workspace administrator, I can receive aggregate operational notifications without receiving another member's private error details.
42. As a Workspace member with access, I can open history and see scheduled occurrences grouped by time, such as “Today, 09:00 · 3 member runs.”
43. As a Workspace member with access, I can expand an occurrence and see one child row per registered member who was dispatched.
44. As a Workspace member with access, I can see each child run's member avatar, member name, status, and timing.
45. As a registered member, I can select my own child run and open its conversation, tool results, output, and detailed errors.
46. As a Workspace member, selecting another member's child run shows a clear message that the run was performed by another member and its content is private to them.
47. As a Workspace administrator, I cannot bypass run-content privacy merely because I can manage registrations.
48. As a registered member, my inputs, conversation, tool results, output, and detailed errors are private to me.
49. As a Workspace member, I can still see safe metadata about another member's run so that shared automation remains understandable and auditable.
50. As a Workspace member, I can distinguish who ran a Coworker from who created or last edited it through consistent names and avatars.
51. As a Workspace member, a manual run continues to execute only for the person who started it and does not fan out to registrations.
52. As a Workspace member, a forwarded-email trigger continues to create one event-driven run and does not fan out to registrations.
53. As a Workspace member, I see the registration management interface only for trigger types that support registration fan-out.
54. As a registered member, leaving the Workspace revokes my registration and prevents future runs from using my identity.
55. As a returning Workspace member, I must explicitly register again so that old consent is not silently restored.
56. As a Workspace administrator, removing a member immediately prevents that registration from being included in future schedule occurrences.
57. As a Coworker owner with existing valid automation consent, I am migrated to an active registration so that existing scheduled behavior continues.
58. As a Workspace member, I am not automatically enrolled during migration merely because I can access the Coworker.
59. As a Coworker editor, I see “No one is registered” when no eligible consenting member was migrated so that the lack of scheduled runs is explicit.
60. As a Workspace administrator, I can see the current registration roster before changing or enabling a schedule.
61. As a Workspace member, I am not shown redundant run-count copy when the visible roster already explains who participates.
62. As a Workspace, each member run consumes one run under the existing Workspace billing and usage limits.
63. As a registered member, a Workspace usage limit may prevent my run according to existing billing behavior without exposing my private content.
64. As a Coworker editor, I am not blocked by a separate registration-count cap in the first release.
65. As a registered member, I can see registration and run status updates without refreshing the page.
66. As a keyboard or assistive-technology user, I can identify and operate registration controls and grouped history with accessible labels and focus behavior.
67. As a Workspace member, member identity remains understandable in retained history even if the member later leaves the Workspace.
68. As a Workspace member, schedule occurrence totals and child statuses remain internally consistent after retries or partial dispatch failures.
69. As a registered member, resuming after a pause affects only future schedule occurrences and does not retroactively create missed runs.
70. As a Coworker editor, disabling or deleting the shared schedule stops future occurrences for all registrations without deleting retained history.

## Implementation Decisions

- Add **Automation Registration** as a first-class domain entity belonging to one Coworker, one Workspace, and one User. Enforce at most one durable registration per Coworker and User pair.
- Model registration lifecycle explicitly, including active, member-paused, administrator-paused, safety-blocked, removed, and membership-revoked outcomes. Preserve who performed administrative actions and why for auditability.
- Treat registration as personal consent. The affected member creates or reactivates it by enabling **Run this schedule for me** or by editing the shared schedule. Authorized administrators may pause or remove it but cannot create it, reactivate it, or choose its Connected Accounts.
- Revoke a registration when its member loses active Workspace Membership. Rejoining the Workspace never reactivates the prior registration automatically.
- Keep one shared schedule per Coworker. Do not create a scheduler per member.
- Represent every scheduler tick as a durable **Schedule Occurrence** with a stable dispatch key. Snapshot the registrations eligible for that occurrence and create one child Coworker Run per active registration.
- Make dispatch idempotent by enforcing one scheduled child run per Schedule Occurrence and Automation Registration. Scheduler, queue, or worker retries must not create duplicates.
- Persist the registration and occurrence relationships on scheduled Coworker Runs. Keep the execution User as the authoritative identity used by runtime authorization.
- Scope scheduled-run concurrency, backlog accounting, repeated-blocked-run safety behavior, and automatic pauses to the Automation Registration. Never disable the shared Coworker or another registration because one member is failing or backlogged.
- Continue to use the existing Workspace billing and usage-limit model. Count every dispatched member run as one billed run.
- Keep registration fan-out limited to scheduled triggers in the first release. Manual starts remain actor-specific. Forwarded-email triggers retain their existing single-run behavior and existing execution-identity rules.
- Make scheduled registration run content private to its execution User. Workspace-safe projections may expose occurrence, member identity, avatar, status, and timing, but not inputs, conversation messages, tool arguments/results, output artifacts, detailed errors, or approval content.
- Apply the same privacy rule to administrators. Registration-management authority grants access to operational metadata and lifecycle controls, not private execution content.
- Store per-registration Connected Account preferences in a private data surface. Key preferences to the integration capability being resolved, and allow a Connected Identity or Account Label to disambiguate a member's compatible accounts.
- Resolve Connected Accounts lazily at Tool Invocation. Automatically use exactly one compatible identity; use the member's private preference when several identities are compatible; otherwise fail that member's run with an actionable private error.
- Do not require a registration-time preflight across all Toolbox Integration Types. Registration remains valid when optional or unused integrations are unavailable.
- Keep shared Coworker configuration independent from personal registration state. Authorized Coworker editors may change the schedule and execution-affecting configuration for everyone, existing active registrations continue without re-consent, and editing the schedule activates the editor's own registration.
- Replace the singular automation-owner management surface for scheduled triggers with an always-visible Schedule section containing the shared schedule, a **Run this schedule for me** switch, an inline member roster, and administrator pause/remove controls. Do not use a separate summary banner, run-count sentence, or accordion, and do not expose private account selections in this surface.
- Group scheduled history by Schedule Occurrence. Child rows show safe member and run metadata. Route an authorized member to their own run content; render a privacy explanation instead of an empty state when they select another member's child run.
- Project only explicitly approved registration and occurrence fields into the realtime Workspace data plane. Keep Connected Account preferences and private run content outside Workspace-readable projections.
- Notify members only about their own runs, subject to preferences. Notify administrators about aggregate registration health and schedule-wide dispatch failures without including member-private execution details.
- Migrate the current eligible, consenting automation owner to the first active registration while preserving the shared schedule. Do not enroll additional Workspace members. If the owner is ineligible or has not consented, create no active registration and expose the empty state.
- Preserve retained run history and safe actor identity after membership changes. Historical runs do not transfer to a replacement member or become visible to administrators.
- Use **Automation Registration**, **registered member**, and **Schedule Occurrence** as canonical product and domain terms. Avoid “installation,” “copy,” and “automation owner” for the scheduled multi-member model.

## Testing Decisions

- Test registration lifecycle policy as observable state transitions: self-registration, self-removal, registration on schedule edit, administrator pause/removal, prohibited third-party registration/reactivation, membership revocation, and explicit re-registration after rejoining.
- Test authorization at service and API boundaries, including ordinary members, Coworker editors, Workspace administrators, former members, and users from another Workspace.
- Test that one schedule tick creates one occurrence and exactly one run for every active registration while excluding paused, blocked, removed, and revoked registrations.
- Test scheduler, dispatcher, and worker retries to prove that the occurrence-plus-registration idempotency boundary prevents duplicate member runs.
- Test concurrent registration changes around a schedule tick and assert that the durable occurrence snapshot produces a coherent, repeatable result.
- Test execution identity for scheduled registration runs and prove that manual and forwarded-email starts retain their existing non-fan-out behavior.
- Test credential isolation by attempting to resolve or invoke tools with zero, one, and multiple compatible Connected Identities for different members.
- Test lazy authorization by registering a member who lacks an unused integration, successfully running a path that does not invoke it, and failing privately only when that integration is actually invoked.
- Test that private Connected Account preferences can be read and changed only by their registered member and are absent from Workspace-safe realtime payloads and administrative responses.
- Test run visibility for the execution User, another registered member, a Coworker editor, a Workspace administrator, a former member, and an unrelated User.
- Test that safe history metadata remains visible while messages, tool data, artifacts, approvals, inputs, and detailed errors remain inaccessible to other members and administrators.
- Test grouped history totals, avatar/name attribution, child statuses, partial dispatch, retained departed-member identity, and the privacy message shown when another member's run is selected.
- Test registration-scoped backlog limits and repeated-blocked-run safety pauses, proving that other registrations and the shared Coworker remain active.
- Test that an ordinary failed run does not pause a registration and that a schedule-wide infrastructure failure is distinguished from a member-specific execution failure.
- Test notification routing so members receive only their own run notifications and administrators receive only aggregate or schedule-wide operational notifications.
- Test billing and usage accounting with several active registrations, partial dispatch, retries, and Workspace limits. Assert one counted run per successfully created member run and no duplicate charge on idempotent retries.
- Test shared edits to the schedule, instructions, Toolbox, trigger configuration, approvals, and inputs. Assert that active registrations continue without re-consent, schedule edits activate the editor's registration, and future occurrences use the updated shared configuration.
- Test disabling and deleting the shared schedule, including preservation of registration records and retained history where product retention rules require it.
- Test migration with a valid consenting owner, an inactive owner, an owner without consent, a removed Workspace member, and repeated migration execution. Assert that at most one member is enrolled and the schedule is preserved.
- Add component-level accessibility tests for registration controls, status labels, avatar alternatives, expandable occurrence rows, keyboard navigation, focus management, and the private-run explanation.
- Add browser-level scenarios covering two or more real Workspace members: registration, one shared occurrence, private child-run access, administrator pause, lazy account failure, and unaffected execution for another member.
- Preserve and extend existing regression coverage for Coworker scheduling, execution identity, run visibility, backlog behavior, billing, notifications, API authorization, and realtime schema allowlists.

## Out of Scope

- Per-member schedules, time zones, frequencies, or trigger parameters.
- Fan-out for manual runs, forwarded emails, webhooks, provider events, or other future external trigger types.
- Registering, consenting, or reactivating another member, including by a Workspace administrator.
- Requiring members to review or re-consent after every shared Coworker edit.
- Per-registration instructions, Toolbox composition, input definitions, approval policy, or other forks of shared Coworker configuration.
- Sharing, pooling, or falling back to another member's Connected Accounts.
- Exposing private account selections, run content, artifacts, approval content, or detailed errors to administrators or other Workspace members.
- A dedicated hard cap on the number of registrations beyond existing Workspace billing and usage limits.
- Retroactively creating runs for schedule occurrences missed while a registration was paused, blocked, removed, or revoked.
- Reassigning historical runs to another member or broadening their visibility after the original member leaves.
- Redesigning general Workspace billing, notification preferences, Connected Account onboarding, or Workspace Membership administration.
- Public Coworker sharing, cross-Workspace execution, or copy/install-based distribution.
- Collaborative text revision history or CRDT behavior beyond the existing shared Coworker editing model.

## Further Notes

- This design supersedes the singular scheduled Automation Owner model and its assumption that all automated run content is Workspace-visible. The relevant canonical Workspace Coworker architecture decision must be replaced or amended before implementation.
- It also supersedes coworker-wide automatic disablement for scheduled backlog failures. Scheduled fan-out requires registration-scoped backlog and safety pauses. Existing behavior for other trigger kinds should remain unchanged until separately designed.
- The privacy change applies to scheduled runs created through Automation Registrations. Forwarded-email and other existing external-trigger privacy behavior is not implicitly changed by this PRD.
- Allowing any member with existing Coworker edit permission to change execution-affecting shared configuration while registrations remain active is an explicitly accepted security and UX tradeoff for the first release. Permission tightening or post-edit review may be considered later if real usage requires it.
- Operational aggregates must be designed conservatively. Status and timing are shareable; errors, tool names or arguments that reveal private intent, inputs, output summaries, and account details are not.
- “Created by” identifies the Coworker's creator. “Ran by” identifies the User behind a particular run. “Registered” identifies a member who has consented to future scheduled runs. The interface should not use these labels interchangeably.
