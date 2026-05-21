# Connected Identities own selectors

CmdClaw supports multiple Connected Accounts for the same User and Integration Type, and each Tool Invocation targets one Connected Account. We decided to introduce Connected Identity as the internal grouping that owns the user-facing Account Label, while each `integration` row remains one credential-bearing Connected Account for one Integration Type under that Connected Identity. The previous one-row-per-User-and-Integration-Type model will be replaced, and Account Labels are no longer owned independently by each Integration Type.

This lets `google-gmail --account work` and `google-drive --account work` refer to the same Account Label while still keeping separate tokens, scopes, and auth metadata per Integration Type. We considered making labels unique per User and Integration Type, but rejected it because it would make identical labels across related tools a coincidence rather than a shared concept.

Connected Identities are grouped automatically by reliable email identity, including across providers, because the common user expectation is that `work@company.com` maps to one Account Label such as `work` across Gmail, Slack, GitHub, and similar tools. This accepts some tenant and workspace edge cases in exchange for a simpler default; users can correct those cases by moving Connected Accounts between Account Labels.

Providers may auto-group by email only when the email is reliable enough to identify the connected user. When reliable email is missing, CmdClaw creates a separate Account Label from the provider-specific identity instead; tenant- or org-sensitive providers should include that context in display text so users can spot accidental grouping.

Migration groups existing user integrations by reliable email identity when available, including across providers, and creates separate Connected Identities from provider-specific display identity when email is missing. Existing `integration.id` values should be preserved as Connected Account IDs where possible, with a new Connected Identity reference added.

Email grouping must not violate the invariant that a Connected Identity has at most one Connected Account per Integration Type. When multiple accounts of the same Integration Type share the same email but differ by workspace, tenant, or org, CmdClaw creates separate Account Labels with contextual suffixes rather than grouping them under one label.

Account Labels are shell-friendly lowercase ASCII slugs using letters, numbers, and dashes. Generated labels prefer email local parts, add workspace/org context when needed, and append numeric suffixes to resolve collisions.

Account Labels are the only first-version display name for Connected Identities. The UI should show provider account details under the label instead of introducing a separate editable display name.

The first UI scope for Account Labels is view labels, rename a label, see Connected Accounts under each label, move a Connected Account to another existing or new label, and disconnect a Connected Account. Bulk merge tools, historical audit UI, and CLI label-management commands are deferred.

We also considered adding a child Connected Account table under the old `integration` row, but rejected it because it would leave `integration` with two meanings and keep credential ownership split away from the row already used by `integrationToken`.

Use Account Label consistently for user-facing UI, CLI, API, and tests. The Connected Identity stores the label, while boundary request fields should use `accountLabel` when `label` alone would be ambiguous.

Disconnecting one Connected Account removes only that Integration Type's credential-bearing connection. The Connected Identity and Account Label remain while any other Connected Account still belongs to them; once the last Connected Account is removed, the Connected Identity can be deleted or archived.

A Connected Identity may have at most one Connected Account for a given Integration Type. Connecting the same Provider Identity for that Integration Type refreshes the existing Connected Account; connecting a different Provider Identity to the same Account Label and Integration Type is blocked unless the existing Connected Account is removed or a different Account Label is chosen.

The UI may move a Connected Account between Account Labels to support explicit cross-provider grouping. Moves are blocked when the destination Connected Identity already has a Connected Account for the same Integration Type.
