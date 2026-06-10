# Measurement Recipes

All endpoints are the local observability stack (`docs/observability.md`):
logs `http://127.0.0.1:9428`, traces (Jaeger API) `http://127.0.0.1:10428`,
metrics `http://127.0.0.1:8428`, redis via `docker exec cmdclaw-local-redis-1`.

## Baselines

cmdclaw (capture generation id, phases, and a Chrome trace):

```sh
/usr/bin/time -p bun run cli chat -m "<prompt>" --timing --perfettoTrace [-q "<answer>"...]
```

Native opencode (same model; run from a scratch dir so repo AGENTS.md doesn't leak in):

```sh
cd /tmp/opencode-bench && /usr/bin/time -p opencode run -m <provider/model> "<prompt>"
```

Interleave the two, 3+ pairs. `--timing` prints `end_to_end_total` plus phases
(`sandbox_connect_or_create`, `opencode_ready`, `agent_init`, `session_ready`,
`pre_prompt_*`, `prompt_to_first_*`, `model_stream`, `post_processing`).
Wall minus `end_to_end_total` ≈ CLI bootstrap + post-completion client work.

## Suspect ladder (coarse → precise)

1. **CLI phase summary / Perfetto trace** (`apps/cli/perfetto-traces/*.json`):
   find the dominant phase. Phases overlap (agent_init runs alongside
   pre_prompt_setup) — read start timestamps, not just durations.
2. **Worker lifecycle timeline** — millisecond stage events
   (`agent.init_opencode_ready`, `agent.init_session_creating`, `opencode.prompt_sent`…):

   ```sh
   curl -sG 'http://127.0.0.1:9428/select/logsql/query' \
     --data-urlencode 'query=cmdclaw.generation.id:"<GEN_ID>"' --data-urlencode 'limit=1000'
   ```

   Sort by `_time`; gaps between consecutive stages are the suspects.
3. **Trace spans** (Daytona SDK calls are spanned; opencode HTTP calls are NOT):

   ```sh
   curl -s "http://127.0.0.1:10428/select/jaeger/api/traces/<TRACE_ID>"
   ```

   A multi-second hole with **no spans** = waiting on the opencode server
   (lazy init, MCP connects) or on the DB — not on Daytona.
4. **Redis event stream** — ms-precise client-visible cadence; separates model
   turns, tool round-trips (`interrupt_pending`→`interrupt_resolved`), and the
   text→`done` tail:

   ```sh
   docker exec cmdclaw-local-redis-1 redis-cli XRANGE "gen:stream:<GEN_ID>" - +
   ```

   Read `createdAtMs` in each envelope. Model turn = `tool_result` → next
   `tool_use`; round-trip = `tool_use` → `tool_result`.

## Isolating sandbox-image problems locally

If init time is suspect, replicate the sandbox `/app` layout on the host and time
cold start vs first real API call (the `/health` readiness probe answers **before**
opencode's lazy project init — the first real call pays it):

```sh
# copy apps/sandbox/src/common/{opencode.json,agents,plugins,tools,lib} into /tmp/ocsbx/.opencode,
# bun install the sandbox runtime deps, then:
OPENCODE_CONFIG=/tmp/ocsbx/opencode.json opencode serve --port 4777 &  # time until /health = 200
time curl -s "http://127.0.0.1:4777/mcp?directory=%2Ftmp%2Focsbx"      # first real call = init cost
```

Re-run with fresh `XDG_CACHE_HOME`/`XDG_DATA_HOME`/`XDG_CONFIG_HOME` to see what a
cold cache costs vs warm — whatever warm caches save locally is what build-time
prewarming will save in the snapshot. Verify in a live sandbox (attach via
`bun run --cwd apps/sandbox daytona:sandbox -- --conversation-id <id>` or create
one with the SDK) that the runtime user/HOME matches the image-build user, else
baked caches are missed.

## Ruling things out

- **Prompt size:** cmdclaw per-turn input ≈ terminal event `cmdclaw.usage.input_tokens`
  ÷ model calls. Native: `sqlite3 ~/.local/share/opencode/opencode.db "select
  json_extract(data,'$.tokens.input') from message"` (or the XDG data dir used for
  the run). If they're close (~13.5k/turn both as of mid-2026), prompt size is not the gap.
- **API account/backend:** re-run native opencode with the shared key and a clean
  profile: `env XDG_CONFIG_HOME=<scratch> ... OPENAI_API_KEY=<shared> opencode run …`.
  Same range ⇒ serving variance, not account class.
- **Output tokens per turn:** compare `tokens.output` per assistant message —
  structured tool calls (question schema) cost real seconds vs one-line bash.

## Operational gotchas

- After `daytona:build:dev` replaces the snapshot, sandbox creation throws
  `No available runners` for ~10–80 min (runner image pull). Probe before benchmarking:
  a small `daytona.create({snapshot})` retry loop. The org is shared with prod
  sandboxes — never kill non-dev-snapshot sandboxes.
- Worker is `bun --watch`: packages/core edits hot-reload, no restart needed.
- Conversation reuse changes the path entirely (sandbox_reused). For cold-start
  benchmarks, omit `-c`; for warm-path checks, use the e2e performance test's
  follow-up pattern.
- The CLI `prompt_to_first_visible_output` metric counts only text/thinking — a
  run whose first output is a tool call reports a misleadingly large value; trust
  the redis stream over this metric.
