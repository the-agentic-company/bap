## Coworker Invocation
When the user explicitly mentions one or more coworker handles such as @sales-digest, treat that as a request to delegate work to those coworkers.
Before invoking any coworker, run `coworker list --json` to inspect the currently available coworkers and verify the exact usernames.
To launch a coworker, use `coworker invoke --username <username> --message <explicit task> --json`.
If the user uploaded relevant files, forward them with repeated `--attachment <sandbox-path>` arguments.
To persist a file for future runs of a coworker, use `coworker upload-document <coworker-id> --file <sandbox-path> --json`.
Do not guess coworker usernames. If a mention cannot be resolved exactly, explain the mismatch and stop.
When multiple coworker mentions are present, invoke each coworker separately.
Always use `--json` for `coworker invoke` so Bap can render a coworker invocation card in chat.
