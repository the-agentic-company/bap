---
name: cmdclaw-opencode-parity
description: Measure and close the latency gap between cmdclaw CLI chat and native local opencode until cmdclaw is at most X% slower. Use when asked to benchmark cmdclaw against opencode, make CLI chat "as fast as opencode", hit a "≤X% slower" target, or find where generation latency goes.
---

# CmdClaw vs OpenCode Latency Parity

Iterate measurement → suspect localization → narrowest fix → re-measurement until
`bun run cli chat` wall time is within the target ratio of native `opencode run`,
while `bun run --cwd apps/web test:e2e:cli:live` stays green.

## Ground rules

- **Variance dominates.** Identical native opencode runs vary 2x+ (e.g. 14–36s on
  gpt-5.5). Never compare single runs. Use ≥3 samples per side, **interleaved**
  (native, cmdclaw, native, …) so time-of-day serving drift cancels. Compare means
  and check distribution overlap.
- **Same model, same prompt** on both sides. Total wall time (`/usr/bin/time -p`)
  is the user-facing metric; phase timings explain it.
- The target "≤X% slower" means: mean(cmdclaw wall) ≤ (1+X/100) × mean(opencode wall).
- Fix the single biggest measured item, re-measure, repeat. Don't fix by guess.

## The loop

1. **Set the target ratio** from the request (default 1.15×).
2. **Baseline both sides** (3+ runs each, interleaved) — commands in
   [MEASUREMENT.md](MEASUREMENT.md) § Baselines.
3. **Decompose cmdclaw's time** with the measurement ladder
   ([MEASUREMENT.md](MEASUREMENT.md) § Suspect ladder):
   CLI `--timing` phases → worker lifecycle logs → trace spans → redis event
   stream cadence. Build a wall-time budget: CLI bootstrap, queue pickup, sandbox
   create, agent init, model turns, tool round-trips, done tail.
4. **Classify each gap** before touching code:
   - *Infra overhead* (init, restarts, polling, serial persistence) → fixable here.
   - *Model time* → verify with token counts and an account A/B before blaming
     cmdclaw ([MEASUREMENT.md](MEASUREMENT.md) § Ruling things out).
   - *Variance* → more samples, not code.
5. **Fix the biggest item narrowly.** If the fix touches the sandbox image or
   anything read at sandbox creation, rebuild with
   `bun run --cwd apps/sandbox daytona:build:dev` and expect **10–80 min of
   "No available runners"** while runners pull the replaced snapshot — probe with
   a direct SDK create loop before benchmarking.
6. **Re-measure (3 runs)**, update the budget, repeat from step 3 until the ratio
   holds or remaining levers need a product/cost decision — then surface those to
   the user instead of forcing them.
7. **Gate:** run `bun run --cwd apps/web test:e2e:cli:live` after the changes and
   keep it fully green before declaring the target met.

## Example use cases

**Pure overhead check (single-turn "hi")** — model time is small, so wall time is
almost all cmdclaw overhead. Best prompt for verifying init/tail fixes:

```sh
/usr/bin/time -p bun run cli chat -m "hi" --timing
/usr/bin/time -p opencode run -m openai/gpt-5.5 "hi"
```

**Multi-tool round-trip check (question tool)** — exercises model turns, tool
round-trips, and approval plumbing; pre-answer with `-q` so it never blocks:

```sh
/usr/bin/time -p bun run cli chat \
  -m "ask me 5 questions across 3 different tool calls" \
  --timing --perfettoTrace -q "a1" -q "a2" -q "a3" -q "a4" -q "a5"
/usr/bin/time -p opencode run -m openai/gpt-5.5 \
  "ask me 5 questions across 3 different tool calls"
```

Note the comparison asymmetry: native opencode answers a question prompt with
plain text/bash (no real user round-trip) and emits far fewer output tokens than
cmdclaw's structured question tool. Per-turn output size and round-trips are
product behavior — report them as such rather than "overhead".

## Reporting

State: per-side samples, means, achieved ratio, the wall-time budget before/after,
what was fixed, and the remaining levers with their cost/risk so the user can
decide (e.g. warm sandbox pools, schema slimming, persistence reordering).
