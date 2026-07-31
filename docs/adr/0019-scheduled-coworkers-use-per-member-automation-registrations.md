---
status: accepted
---

# Scheduled Coworkers use per-member Automation Registrations

A Workspace-shared Coworker has one shared schedule and may have many active
**Automation Registrations**. An Automation Registration records a Workspace
member's choice for that shared schedule to start a private Coworker Run using
their execution identity and authorizations. A member opts in by enabling **Run
this schedule for me** or by editing the shared schedule.

Each scheduler tick creates one durable **Schedule Occurrence**. The dispatcher
creates at most one Coworker Run per active Automation Registration for that
occurrence. The occurrence and registration together are the idempotency key, so
queue retries cannot create a duplicate member run.

Only a member can create or reactivate their own registration, including through
a schedule edit. A Workspace administrator may pause or remove a registration but
cannot opt in or choose Connected Accounts for another person. Losing Workspace
Membership revokes the registration; rejoining requires explicit registration
again.

Scheduled registration run content is private to its execution User. Other active
Workspace members, including administrators, can see safe operational metadata:
the occurrence, member name and avatar, status, and timing. They cannot read the
trigger input, conversation, Tool Invocation arguments or results, approvals,
artifacts, output, detailed errors, or private Connected Account preferences.

Backlog, repeated-blocked-run safety pauses, and failures are scoped to a single
Automation Registration. One member's state never disables the shared Coworker,
removes its scheduler, or pauses another registration.

The schedule and behavior-affecting Coworker configuration remain shared. Members
with edit access may change them for everyone, and existing registrations continue
without another consent review. Editing the schedule activates the editor's own
registration. Connected Account resolution remains lazy at Tool Invocation and
uses only the execution User's authorizations.

Manual runs remain actor-specific. Forwarded-email and other non-scheduled external
triggers do not fan out in this decision and may continue using the compatibility
Automation Owner model until separately redesigned.

This decision supersedes ADR-0018 where it assigns scheduled execution to one
Automation Owner or makes scheduled automated content Workspace-visible. It also
supersedes ADR-0015's Coworker-wide backlog disablement for scheduled registration
runs; ADR-0015 continues to govern other existing trigger flows.
