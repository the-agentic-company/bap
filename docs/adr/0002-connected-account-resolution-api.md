# Connected Account resolution API

CmdClaw integration CLIs should not use provider-specific access token environment variables as their core credential contract. We decided that each integration CLI will declare its Integration Type, accept a shared Connected Account Selector, and resolve credentials through a shared Connected Account resolution API that enforces zero-account, single-account, ambiguous-account, and selector-not-found cases consistently. Provider-specific environment variables may remain as a compatibility transport while the runtime evolves, but they are not the long-term architecture.

The resolution API executes inside the sandbox/tool process and calls back to a runtime credential service just in time instead of requiring all credentials to be preloaded before the agent starts. This keeps refresh and revocation server-side, supports newly connected accounts during a conversation, and gives CmdClaw an audit point for which Connected Account each Tool Invocation used.

Sandbox/tool processes authorize credential resolution with a short-lived Generation-scoped runtime credential grant, not a user session token or a broad server secret. The grant is bound to the generation, conversation, user, allowed Integration Types, and expiry; each resolution request returns only the requested Connected Account credential and is audit logged.

The initial grant policy is Integration Type scoped: if a type is allowed, any Connected Account of that type owned by the User may be resolved. The grant model should still be shaped so a future policy can restrict specific Connected Account IDs without replacing the resolution API.

When no Connected Account exists for an Integration Type, the existing auth-required flow can connect one during the conversation. The original Tool Invocation may retry automatically only if exactly one matching Connected Account exists after auth completes; otherwise resolution returns the same ambiguity behavior as any other multi-account invocation.

Credential resolution audit records should store the exact Connected Account ID, the Connected Identity ID, the Integration Type, and an Account Label snapshot from the time of the Tool Invocation so later label renames or account moves do not rewrite history.

Account Labels resolve against current state at Tool Invocation time. If a label is renamed during an active generation, the old label is not kept as a generation-local alias; subsequent invocations must use the current label and can recover from label-not-found errors that list current labels.

Generated tool instructions list Account Labels per Integration Type, not all labels for the user. Labels that cannot provide a Connected Account for the current Integration Type are omitted from that tool's instructions and from its ambiguity recovery list.

When auth is triggered for a missing Integration Type, Account Label assignment happens after OAuth returns the Provider Identity. The UI can then suggest linking the new Connected Account to an existing Account Label or creating a new one with an informed default.

When a Tool Invocation resumes from an auth flow, it uses the specific Connected Account selected or created by that auth flow for that invocation, even if other labels become available before retry. Future invocations without `--account` return to normal live label resolution and ambiguity behavior.

Every account-capable CLI exposes `--account <label>` consistently. The flag is valid even when only one Account Label can provide the Integration Type, but it is required only when more than one label can.

The canonical syntax is `<tool> --account <label> <subcommand> [args]`, though tools may accept the flag in other positions when their parser supports it.

The `--account` flag is reserved across integration CLIs for Account Labels. Provider-domain concepts that also use the word account must use more specific flags such as `--account-id`, `--company-id`, or `--username`.

Runtime and API boundaries should name the parameter `accountLabel` even though the CLI flag is `--account`. Resolution results should include the Account Label snapshot, Connected Identity ID, Connected Account ID, and Integration Type.

The resolution API should return stable machine-readable error codes for distinct recovery paths: `auth_required`, `account_label_required`, `account_label_not_found`, `account_label_not_connected`, `account_not_allowed`, `account_reauth_required`, and `transient_auth_error`.

Reauth preserves the existing Account Label and Connected Identity when the provider returns the same Provider Identity. If reauth returns a different Provider Identity for the same Account Label and Integration Type, replacement is blocked unless the user explicitly chooses to replace or disconnect first.

OAuth state must distinguish first connect, connect to an existing Account Label, and reauth of a specific Connected Account. Callback handling cannot rely only on User and Integration Type once multiple Connected Accounts exist.

Minimum implementation coverage should include schema invariants, OAuth connect and reauth cases, resolution API error cases, CLI `--account` parsing, ambiguity recovery copy, and generated tool instructions listing only labels usable for each Integration Type.

Server-level credentials, such as bot tokens, are not Connected Accounts and do not participate in Account Labels. Mixed tools must distinguish user-account operations from server-credential operations, such as Slack `--as user` using a Connected Account while Slack `--as bot` uses the server-side bot relay.

Shared workspace/provider auth remains separate from Account Labels for now. Account Labels represent user-owned Connected Accounts; shared credentials continue to use their existing source policy and should not be selected through `--account`.

Custom integrations are not included in the first Account Label implementation, but the resolution API should not assume only built-in integrations exist. Custom integration credentials can adopt Account Labels in a later phase without replacing the CLI-facing `--account <label>` contract.
