# Coworker Run Backlog Does Not Block Run Now

Manual **Run Now** starts and **Runtime-Originated Runs** through the **Bap MCP Server** are blocked only by an actively `running` **Coworker Run**; waiting runs such as `needs_user_input`, `awaiting_approval`, `awaiting_auth`, and `paused` are **Coworker Run Backlog** and do not block a user-intent run from starting. External automated triggers are more conservative: when backlog reaches five runs for a **Coworker**, Bap auto-disables that **Coworker** to stop runaway trigger accumulation. Re-enabling after auto-disable requires an explicit **Coworker Run Reset**, which marks non-terminal runs as `cancelling`, enables the **Coworker** optimistically, and lets linked Generations/runtime cleanup settle to terminal cancellation asynchronously.

**Consequences**

- `cancelling` is a non-terminal **Coworker Run** status that does not count toward backlog caps and does not block manual or automated starts.
- The automated-trigger backlog cap counts `needs_user_input`, `awaiting_approval`, `awaiting_auth`, and `paused`, but not `running`, `cancelling`, `completed`, `error`, or `cancelled`.
- Auto-disabled **Coworkers** need UI copy that distinguishes automatic backlog disablement from a user turning the **Coworker** off.
- Auto-disable is recorded with coworker-level disable metadata such as `disabledReason = "run_backlog_limit"` and `disabledAt`, not only `status = "off"`.
- The backlog cap is enforced before creating a new pending start or **Generation**; if five backlog runs already need attention, the incoming automated trigger disables the **Coworker** and creates no sixth backlog run.
- Automated trigger jobs that cause auto-disable are acknowledged as handled skips rather than retried failures.
- `cancelling` is a **Coworker Run** status only; linked **Generations** keep their current non-terminal status with cancellation requested until they settle to terminal `cancelled`.
- A **Coworker Run Reset** is optimistic: it marks affected runs as `cancelling`, enables the **Coworker**, and relies on runtime cancellation or background maintenance to settle linked **Generations** and runs to terminal `cancelled`.
- **Runtime-Originated Runs** bypass the backlog cap like direct manual **Run Now** because they carry user intent; **Spawn Depth** remains the separate loop guard for Bap MCP chains.
- Coworker starts should carry an explicit start classification such as `user_intent` versus `external_trigger`; backlog auto-disable applies to `external_trigger` starts, not to user-intent starts inferred indirectly from trigger payload shape.
- Turning a **Coworker** off blocks `external_trigger` starts only; `user_intent` starts may still run an off or auto-disabled **Coworker** while respecting the active `running` conflict.
- The destructive **Coworker Run Reset** CTA is shown for auto-disabled **Coworkers** or when normal enable would immediately hit the backlog cap, not for ordinary manually-off **Coworkers** without backlog pressure.
- **Coworker Run Reset** is a bulk, confirmed action: the user should not need to open and cancel each waiting run individually.
- **Coworker Run Reset** cancels all non-terminal **Coworker Runs** for the **Coworker**, regardless of whether they came from a user-intent start or an external automated trigger.
- Any workspace **User** who can access and run the **Coworker** may perform a **Coworker Run Reset**; it is not limited to owners or admins, but the reset records the acting **User** for auditability.
