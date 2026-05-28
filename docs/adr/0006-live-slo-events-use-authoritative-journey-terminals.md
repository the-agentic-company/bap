# Live SLO Events Use Authoritative Journey Terminals

CmdClaw emits live `cmdclaw_slo_events_total` from the authoritative terminal owner for each **SLO Journey**, so user-facing reliability is counted once even when retries, recovery, or reconciliation paths touch the same workflow. Generation-backed journeys use the terminal Generation canonical event guard, while `coworker_run` has its own coworker-run-level SLO emission guard because a Coworker Run can fail before a Generation exists and that failure is still visible to the user. SLO Journey classification, terminal result classification, traffic labeling, global rollup emission, and metric emission live in one SLO Journey module that terminal owners call with terminal facts. Each emitted journey event also emits the `global` rollup sample with the same result and traffic provenance, and result classification is based on bounded terminal reason semantics rather than lifecycle status alone so user-intended cancellations can count as good while platform-driven cancellations count as bad.

The Coworker Run guard is durable state on the `coworker_run` row, such as `slo_emitted_at`, claimed atomically before metric emission. If emission fails after the claim, the guard is reset so the SLO event can be retried instead of permanently dropped.

**Considered Options**

- Emit only from terminal Generations: reuses the existing dedupe guard, but obscures Coworker Run failures that happen before Generation creation.
- Emit from every path that marks a workflow terminal: covers more failures, but risks double-counting when multiple paths reconcile the same terminal state.
- Emit from authoritative journey terminal owners with explicit guards: preserves user-facing accounting while keeping each SLO event exactly once.
