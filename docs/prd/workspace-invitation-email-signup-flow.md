# PRD: Workspace Invitation Email Signup Flow

## Problem Statement

Bap Workspace admins need to invite people into a **Workspace** by email before those people have Bap accounts. Today, a Workspace admin needs the product to support the normal collaboration flow: enter one or more email addresses, send a polished HTML invite email, let each invited recipient create an account or sign in from that link, and have that recipient join the intended Workspace as part of the invite flow.

The feature must sit on top of the current Better Auth organization-backed Workspace model. The broader Workspace-to-organization transition is already complete; this PRD is only about the invitation product flow and the new invite-related code needed to make it reliable, secure, and user-facing.

## Solution

Build a first-class **Workspace Invitation** flow using Better Auth organization invitations underneath Bap's Workspace product APIs. Workspace admins continue to use Bap Workspace settings and Bap workspace oRPC APIs. Better Auth remains the underlying auth primitive for invitation storage, email ownership checks, acceptance, rejection, cancellation, and membership creation.

A Workspace admin can invite one or more email addresses from Workspace settings. Bap creates pending Workspace Invitations for those emails and sends an HTML email containing a product route invitation link. The recipient opens the invite link, signs up or logs in with the invited email address, completes any required email verification, and joins the Workspace from the invitation flow. After joining, the recipient should land in Bap with the invited Workspace active or immediately accessible as their current Workspace context.

The preferred recipient experience is link-driven and low-friction: if the recipient arrives from a valid invitation link and proves ownership of the invited email address, Bap should complete the Workspace join without leaving them in a separate manual setup task. A review/accept screen is acceptable only when it is needed for explicit consent, rejection, or error recovery; the create-account path must still end with the recipient becoming a member of the intended Workspace.

## User Stories

1. As a **Workspace Admin**, I want to enter an email address in Workspace settings, so that I can invite a collaborator who does not have a Bap account yet.
2. As a **Workspace Admin**, I want to enter multiple email addresses at once, so that I can invite a small group without repeating the form.
3. As a **Workspace Admin**, I want invalid email addresses rejected before invitation creation, so that I do not create broken pending invitations.
4. As a **Workspace Admin**, I want duplicate email inputs normalized, so that one email receives one useful invitation per submit.
5. As a **Workspace Admin**, I want invites to work for existing Bap users, so that current users can join another Workspace through the same flow.
6. As a **Workspace Admin**, I want invites to work for people without Bap accounts, so that account creation does not block collaboration setup.
7. As a **Workspace Admin**, I want Bap to send an HTML invite email, so that recipients understand the invitation and trust the action.
8. As a **Workspace Admin**, I want the email to name the Workspace, so that the recipient knows which Workspace they are joining.
9. As a **Workspace Admin**, I want the email to identify the inviter, so that the recipient has context for the invitation.
10. As a **Workspace Admin**, I want the email to include a clear call to action, so that the recipient can open the invitation without guessing.
11. As a **Workspace Admin**, I want the email to include a copyable plain URL, so that recipients can recover if the button does not work.
12. As a **Workspace Admin**, I want the email to include plain-text content as well as HTML, so that it works in restrictive email clients.
13. As a **Workspace Admin**, I want pending invitations to appear in Workspace settings, so that I can see who has been invited but has not joined.
14. As a **Workspace Admin**, I want pending invitations to show email and role, so that I can audit intended access.
15. As a **Workspace Admin**, I want to cancel a pending invitation, so that a mistaken or stale invite no longer grants access.
16. As a **Workspace Admin**, I want re-inviting an email to replace or cancel prior pending invitations according to Better Auth policy, so that recipients do not accumulate conflicting invite links.
17. As a **Workspace Admin**, I want invitation results to be clear after submission, so that I know whether invites were created or failed.
18. As a **Workspace Admin**, I want only Workspace owners and admins to invite members, so that normal members cannot expand Workspace access.
19. As a **Workspace Member**, I do not want to see enabled invite controls if I lack permission, so that the UI reflects my access level.
20. As a **Platform Admin**, I want internal support flows to remain separate from normal invitation behavior, so that platform debugging tools do not weaken Workspace invitation policy.
21. As an invited recipient, I want the invitation link to open a Bap-branded page, so that I can trust that I am joining the intended product.
22. As an invited recipient without an account, I want the invite link to take me through account creation, so that I can join without asking the admin to retry later.
23. As an invited recipient with an account, I want the invite link to take me through sign-in, so that I can join from my existing account.
24. As an invited recipient, I want the email field prefilled or constrained to the invited email when possible, so that I do not accidentally create or use the wrong account.
25. As an invited recipient, I want Bap to require ownership of the invited email, so that someone who finds an invite link cannot claim it with a different account.
26. As an invited recipient, I want any required email verification handled before membership is granted, so that Workspace access is tied to verified email ownership.
27. As an invited recipient, I want to become a member of the invited Workspace after completing signup or sign-in, so that the invitation accomplishes the join action.
28. As an invited recipient, I want the invited Workspace to be active after joining, so that I immediately land in the right context.
29. As an invited recipient, I want to see a useful error when an invitation is expired, canceled, rejected, or unavailable, so that I know why I cannot join.
30. As an invited recipient, I want to reject or ignore an invitation without receiving access, so that I control whether I join.
31. As an invited recipient, I want accepting one invitation not to grant access to other Workspaces, so that access remains scoped to the invited Workspace.
32. As an invited recipient, I want invitation acceptance to be idempotent enough for refreshes and double-clicks, so that retrying does not create duplicate memberships.
33. As an invited recipient, I want stale invitation links to fail closed, so that expired or canceled access cannot be revived unexpectedly.
34. As a **User**, I want Bap to keep using the word **Workspace**, so that the invitation flow matches the rest of the product.
35. As a **User**, I do not want to see Better Auth organization terminology, so that the product model stays simple.
36. As a developer, I want Bap workspace APIs to remain the product boundary, so that Workspace policy is enforced consistently server-side.
37. As a developer, I want Better Auth organization invitations to be the underlying invitation primitive, so that Bap does not maintain a parallel custom invitation lifecycle.
38. As a developer, I want the invitation email renderer to be a deep module, so that HTML, text, escaping, and URL generation can be tested without auth setup.
39. As a developer, I want the invitation orchestration API to be a deep module, so that role checks, invite creation, cancellation, and result shaping are testable without UI coupling.
40. As a developer, I want the invitation landing view to be a small state machine, so that loading, unauthenticated, ready, accepted, rejected, and error states are explicit and testable.
41. As a developer, I want invitation IDs treated as sensitive action-capable tokens, so that listing pending invites does not accidentally become a recipient-claim bypass.
42. As a developer, I want session-backed invitation operations to use Better Auth APIs where possible, so that Better Auth policy hooks and email behavior run normally.
43. As a developer, I want non-session server contexts to have a narrow fallback only when needed, so that hosted/runtime contexts do not bypass workspace admin checks.
44. As a developer, I want invite acceptance to set or refresh active Workspace context, so that subsequent Bap calls use the joined Workspace.
45. As a developer, I want cache invalidation after invite creation, cancellation, and acceptance, so that Workspace settings and switchers show current membership state.

## Implementation Decisions

- The PRD is scoped only to Workspace invitation behavior after the Better Auth organization-backed Workspace cutover.
- The product term remains **Workspace** in UI, docs, and Bap-facing APIs.
- Better Auth organization invitations are the source of truth for pending, accepted, rejected, canceled, and expired invitation state.
- Bap keeps the workspace oRPC surface as the product boundary for inviting members, listing members and invitations, and canceling invitations.
- Client UI should not call Better Auth organization APIs directly for admin invitation management; it should use Bap Workspace hooks and APIs so Bap can enforce product policy, hosted MCP constraints, self-host rules, and cache behavior.
- The recipient invitation route may call Better Auth's organization invitation client APIs because that route is auth-specific and directly represents the recipient's invitation action.
- Normal Workspace invites create Better Auth invitation rows rather than inserting member rows directly.
- Pending invitations must not grant Workspace access before successful acceptance by the invited email owner.
- Invitation acceptance must require the recipient to authenticate as, and where required verify, the invited email address.
- Invitation IDs must be treated as action-capable credentials. Any flow that exposes invitation IDs must rely on Better Auth's verified-email checks or additional Bap server-side checks before acceptance or rejection.
- The recipient account creation path should complete the Workspace join from the invite link. The desired product outcome is that a new account created through an invite becomes a member of the invited Workspace and lands in that Workspace context.
- If the implementation keeps a review screen, it should be a consent/error recovery surface, not a disconnected second onboarding task.
- The invite link should target a Bap product route, not a raw Better Auth endpoint, so Bap controls copy, routing, login callback handling, and error states.
- The login/signup flow should preserve the invitation return URL through authentication.
- The login/signup flow should prefill the invited email when possible.
- After successful acceptance, Bap should set the accepted Workspace as active for the user's session or otherwise route them into the accepted Workspace as the current context.
- Workspace owners and admins can invite members.
- Normal Workspace members cannot invite members.
- Workspace owners and admins can cancel pending invitations.
- Canceled, rejected, expired, or missing invitations should produce clear user-facing errors and should not create membership.
- Re-inviting an email should use Better Auth's pending-invitation cancellation/reinvite behavior rather than creating multiple active pending invitations for the same Workspace/email pair.
- Invite creation should support role assignment for `member` and `admin`, but the default and normal UI path should be `member`.
- Better Auth teams remain disabled for this flow.
- Better Auth organization deletion remains disabled and is unrelated to this flow.
- **Platform Admin** authority remains separate from Workspace roles and should not be confused with invite recipient membership.
- Self-hosted behavior is out of the normal cloud invitation path; self-hosted can keep its automatic single shared Workspace policy.
- The Workspace invitation email renderer should be a deep module with a simple interface: invitation URL, Workspace name, and inviter email in; HTML and text payloads out.
- The email renderer must HTML-escape user-controlled values such as Workspace names and email addresses.
- The email renderer should produce a stable Bap logo URL that avoids unusable loopback URLs in delivered email.
- The email renderer should include security-oriented text that tells recipients they need to sign in with the invited email and can ignore unfamiliar invites.
- The Workspace invitation URL builder should encode invitation IDs safely.
- The Workspace settings member section should list current members and pending invitations in one management surface.
- The Workspace settings member section should provide invite submission and cancellation controls with loading and disabled states.
- The invitation orchestration API should normalize email inputs server-side even if client validation exists.
- The invitation orchestration API should verify Workspace admin membership server-side before creating or canceling invitations.
- The invitation orchestration API should verify the invitation belongs to the selected Workspace before canceling it.
- The invitation landing route should have explicit states for loading, unauthenticated, ready, accepted, rejected, and error.
- The invitation landing route should redirect unauthenticated recipients into login/signup with the invitation route as callback.
- The invitation landing route should not show Workspace data from unavailable invitations.
- The invitation landing route should support accepting and rejecting invitations.
- The invitation landing route should route accepted users into Bap after joining.
- Cache invalidation should refresh billing overview, member lists, pending invitations, and user/workspace state where affected.

## Testing Decisions

- Tests should assert external behavior and durable contracts, not private helper structure.
- Good tests for this feature should verify who can invite, what invitation state is created, what email content is produced, what route state is shown, and whether membership is granted only after valid acceptance.
- The email renderer should have focused unit tests for product URL construction, HTML/text rendering, escaping, and loopback-logo fallback behavior.
- The workspace management API should have router tests for invite creation by Workspace admins.
- The workspace management API should have router tests that non-admin Workspace members cannot invite or cancel invitations.
- The workspace management API should have router tests that cancellation rejects invitations outside the selected Workspace.
- The workspace management API should have router tests that session-backed invite creation calls Better Auth invitation APIs.
- The workspace management API should have tests for non-session fallback invitation creation only where hosted/runtime contexts require it.
- The Workspace lifecycle invitation helper should have tests for email normalization, duplicate handling, pending invitation cancellation on re-invite, expiration timestamps, and scoped cancellation.
- The member listing behavior should have tests that current members and pending invitations are returned together without granting access for pending invitations.
- The invitation landing view should have UI tests for unauthenticated recipients being sent to login with a return URL.
- The invitation landing view should have UI tests for loading a valid invitation and accepting it.
- The invitation landing view should have UI tests for rejecting an invitation.
- The invitation landing view should have UI tests for unavailable invitation errors.
- The login/signup client should have tests for prefilled invite email and callback preservation where that behavior is implemented.
- Acceptance flow tests should verify email ownership or email verification policy is enforced through Better Auth or an app-level wrapper.
- Acceptance flow tests should verify accepted invitations create Workspace membership.
- Acceptance flow tests should verify accepted invitations activate or route into the accepted Workspace.
- Acceptance flow tests should verify expired, canceled, and rejected invitations fail closed.
- Workspace settings UI tests should verify invite controls, pending invitation rendering, and cancellation behavior.
- Existing prior art includes auth handler tests, Workspace invitation route tests, workspace invitation email tests, billing router tests, Workspace lifecycle tests, and Workspace settings UI tests.
- After implementation, run targeted tests for invitation email rendering, invitation route behavior, workspace management router behavior, Workspace lifecycle invitation helpers, and login/signup callback handling.
- After implementation, run `bun run check`.

## Out of Scope

- Reworking the broader Better Auth organization-backed Workspace migration.
- Dual-reading or dual-writing old custom Workspace invitation tables.
- Renaming Workspace to Organization in the product.
- Enabling Better Auth teams.
- Exposing Workspace deletion.
- Redesigning Workspace roles beyond `owner`, `admin`, and `member`.
- Redesigning global **Platform Admin** behavior.
- Reworking billing, Workspace image storage, Workspace MCP, hosted MCP OAuth, Zero permissions, or resource-table Workspace scoping except where invite acceptance needs current Workspace context.
- Building a general audit-record system for invitation lifecycle events.
- Building bulk CSV upload or directory sync.
- Building invitation analytics dashboards.
- Building custom branded email templates per Workspace.
- Building invite reminders or scheduled resends unless they fall out of Better Auth's existing reinvite behavior.
- Supporting arbitrary role creation or dynamic access control for invitations.
- Creating or updating issue tracker tickets directly.

## Further Notes

- This PRD follows ADR-0017: Bap keeps **Workspace** as the product term while using Better Auth organizations, members, active organization, and invitations as the underlying auth primitives.
- Better Auth's organization plugin supports organization invitations, invitation email hooks, accept/reject/cancel/list flows, active organization, members, and organization deletion disablement. Bap should use those primitives rather than rebuilding a parallel invitation system.
- The most important product invariant is that a pending invitation is not access. Access starts only when the invited email owner completes the invitation flow.
- The most important UX invariant is that a new user invited by email can create an account from the invite and end up in the intended Workspace without needing the inviter to take another action.
- The main implementation risk is the handoff between invite link, login/signup callback, email verification, invitation acceptance, and active Workspace selection. That boundary should be treated as the deep module/flow to test most heavily.
