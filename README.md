<p align="center">
  <img src="apps/web/public/logo.png" alt="Bap" width="80" />
</p>

<h1 align="center">Bap</h1>

<p align="center">
  The OS for AI Agents
</p>

<p align="center">
  Bap turns plain-English tasks into AI agents that run across your tools, ask for approval when needed, and surface work through an inbox.
</p>

<p align="center">
  <a href="https://docs.heybap.com"><img src="https://img.shields.io/badge/docs-heybap.com-0f7acb?style=flat-square" alt="Docs" /></a>
  <a href="https://discord.com/invite/NHQy8gXerd"><img src="https://img.shields.io/badge/discord-join-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-2f855a?style=flat-square" alt="MIT License" /></a>
  <a href="https://github.com/baptistecolle/bap/actions/workflows/ci-code-quality.yml"><img src="https://img.shields.io/github/actions/workflow/status/baptistecolle/bap/ci-code-quality.yml?branch=main&style=flat-square&label=ci" alt="CI" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/AI_Agents-0b1220?style=flat-square" alt="AI Agents" />
  <img src="https://img.shields.io/badge/Approvals-0b1220?style=flat-square" alt="Approvals" />
  <img src="https://img.shields.io/badge/Inbox-0b1220?style=flat-square" alt="Inbox" />
  <img src="https://img.shields.io/badge/Templates-0b1220?style=flat-square" alt="Templates" />
  <img src="https://img.shields.io/badge/16_Integrations-0b1220?style=flat-square" alt="16 Integrations" />
  <img src="https://img.shields.io/badge/CLI-0b1220?style=flat-square" alt="CLI" />
  <img src="https://img.shields.io/badge/MCP-0b1220?style=flat-square" alt="MCP" />
</p>

<p align="center">
  <a href="https://heybap.com">Website</a> &middot;
  <a href="https://docs.heybap.com">Docs</a> &middot;
  <a href="https://docs.heybap.com/self-hosting">Self-Hosting</a> &middot;
  <a href="https://discord.com/invite/NHQy8gXerd">Discord</a>
</p>

<!-- DO NOT DELETE: Regenerate this GIF from /Users/baptiste/Git/bap/apps/web with `bun scripts/export-readme-preview.ts` while the web app is running and /internal/readme-preview is reachable. -->
<p align="center">
  <img src=".github/assets/readme/bap-agent-inbox.gif" alt="Bap prompt-to-agent inbox workflow" width="100%" />
</p>

## What Is Bap?

Bap is a platform for building and running AI agents across company tools. You can describe a workflow in plain English, launch from a template, or drive the same runtime through chat and the CLI.

Agents can handle one-off tasks or recurring workflows, then escalate through approvals and auth requests in a shared inbox before they act on connected systems.

## Core Capabilities

- **Prompt to agent**: turn plain-English tasks into runnable agents with manual, scheduled, email, or webhook triggers.
- **Templates**: start from prebuilt workflows instead of configuring every agent from scratch.
- **Inbox and approvals**: sensitive actions pause for approval or auth and surface in one place.
- **Connected tools**: agents run across the 16 currently available integrations in the repo, including Gmail, Slack, Notion, GitHub, HubSpot, Salesforce, and more.
- **Multiple interfaces**: use the web app, CLI, or MCP server depending on how you want to operate agents.

## Interfaces

- **Web app**: build, run, and monitor agents from the main product surface.
- **CLI**: work with `chat`, `auth`, and `coworker` command groups from the terminal.
- **MCP server**: expose Bap capabilities to external agent and tool workflows.
```bash
bun run bap -- --help
```

## Quickstart

```bash
bun install
docker compose -f docker/compose/dev.yml up -d
cp .env.example .env
bun run --cwd packages/db db:push
bun dev
```

`bun dev` starts the web app, worker, and WS runtime together. `bun dev:web` only starts the web app, so it is not enough for end-to-end local runs on its own.

The same local Docker stack now also starts the observability backend. Once the app is running, you can query it directly over HTTP:

```bash
curl -s http://127.0.0.1:9428/select/logsql/query -d 'query=service:bap-web OR service:bap-worker' -d 'limit=10'
curl -s 'http://127.0.0.1:8428/api/v1/query?query=bap_rpc_requests_total'
curl -s http://127.0.0.1:10428/select/jaeger/api/services
```

Grafana, `vmalert`, and Alertmanager are part of the same local stack as code-managed observability components:

```bash
open http://127.0.0.1:3400
curl -s http://127.0.0.1:8428/api/v1/rules
```

All of those observability ports are overrideable with `BAP_*_PORT` env vars, so separate worktrees can run their own local stack without host-port collisions.

More setup guides:

- [Quickstart](https://docs.heybap.com/quickstart)
- [Self-hosting](https://docs.heybap.com/self-hosting)
- [Integrations](https://docs.heybap.com/integrations/overview)
- [Worktrees](docs/worktree.md)

## Repo Structure

```text
bap/
├── apps/
│   ├── web/       # TanStack Start web app
│   ├── worker/    # BullMQ worker runtime
│   ├── ws/        # WebSocket runtime
│   ├── cli/       # Terminal interface
│   ├── mcp/       # MCP server
│   └── sandbox/   # Sandbox runtime assets and build tooling
├── packages/
│   ├── core/      # Shared runtime logic
│   ├── db/        # Drizzle schema and database client
│   ├── client/    # Shared client runtime
│   └── config/    # Shared tooling config
├── docs/          # Mintlify documentation site
└── infra/         # Infrastructure and deployment
```

## Docs

- [Docs home](https://docs.heybap.com)
- [Quickstart](https://docs.heybap.com/quickstart)
- [Self-hosting](https://docs.heybap.com/self-hosting)
- [Integrations overview](https://docs.heybap.com/integrations/overview)

## Contributing

Contributions are welcome. Open an issue, submit a pull request, or propose a new integration or agent workflow.

## License

MIT. See [LICENSE](LICENSE).
