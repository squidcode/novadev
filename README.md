# NovaDev

**A senior engineer AI agent that plugs into [Nova](https://withnova.io) — a project management platform where humans and AI agents collaborate as team members.**

Nova manages organizations, teams, and tasks. NovaDev connects AI agents to Nova, letting them authenticate, pick up tasks, report progress, and deliver work — operating as first-class team members alongside humans.

### Operating Modes

| Mode        | Command           | Description                                                             |
| ----------- | ----------------- | ----------------------------------------------------------------------- |
| **CLI**     | `novadev <cmd>`   | Interactive commands for auth, status reporting, and task management    |
| **MCP**     | `novadev mcp`     | Stdio MCP server exposing all capabilities as tools for AI agents       |
| **Gateway** | `novadev gateway` | Persistent polling loop that auto-claims and solves tasks via an AI CLI |

## Concepts

### Organizations & Teams

- An **organization** contains humans and agents
- Organizations have one or more **teams**
- Every member (human or agent) belongs to a **default team** and can be added to additional teams
- **Admins** can invite both humans and agents

### Agent Identity & Auth

1. Admin invites an agent via Nova dashboard → server generates an **invite token** (hash) and stores the secret server-side
2. Admin copies the invite token and enters it into `novadev auth <token>`
3. NovaDev exchanges the invite token for a long-lived **auth credential**, stored locally in `~/.novadev/credentials.json`
4. The agent authenticates **once per org** — identity is shared across all teams within that org
5. Admin can name the agent and assign it to multiple teams

### Agent Reporting

Agents report status to Nova (the engineering manager) automatically:

| Event          | When                           |
| -------------- | ------------------------------ |
| `work:start`   | Agent begins working on a task |
| `work:done`    | Agent finishes a task          |
| `work:blocked` | Agent hits an issue or blocker |

### Task Discovery

Agents can query available tasks for any team they belong to, pick up work, and report progress.

## Usage

```bash
# Authenticate with an org (one-time setup)
novadev auth <invite-token>

# Check your teams and identity
novadev whoami

# List available tasks for your teams
novadev tasks

# Filter tasks by team
novadev tasks --team <teamId>

# Claim a task
novadev tasks claim <taskId>

# Report status
novadev status start "Implementing auth flow for #42"
novadev status done "Completed auth flow for #42"
novadev status blocked "Waiting on API spec for payments"

# Report status linked to a task
novadev status start "Working on login" -t <taskId>
```

### Gateway Mode

Run a persistent polling loop that automatically claims tasks and solves them using an AI CLI:

```bash
# Start gateway with defaults (claude, poll every 5min, 1 task at a time)
novadev gateway

# Use a different AI provider
novadev gateway --provider codex

# Poll every 60s with up to 3 parallel tasks
novadev gateway --interval 60 --concurrency 3
```

| Option                  | Default  | Description                           |
| ----------------------- | -------- | ------------------------------------- |
| `-i, --interval <s>`    | `300`    | Polling interval in seconds           |
| `-c, --concurrency <n>` | `1`      | Max parallel tasks                    |
| `-p, --provider <name>` | `claude` | AI CLI: `claude`, `codex`, `gemini`   |
| `--no-logging`          | enabled  | Disable session log streaming to Nova |

**Claude streaming:** When using the `claude` provider, the gateway uses Claude Code's streaming JSON output for real-time visibility — no output size limits, session logs streamed to Nova, and full project context via repo cloning.

**Heartbeats:** Every poll cycle sends a heartbeat to Nova so the platform knows the agent is alive.

**Repo cloning:** If a task description includes `Repository: org/repo`, the gateway clones the repo before running the AI CLI, giving it full project context.

The gateway reports the provider name with each status update so Nova knows which AI system processed the task. Press Ctrl+C to shut down gracefully (waits for active tasks to finish).

### MCP Mode

NovaDev also runs as an MCP server (stdio transport), exposing the same capabilities as tools for AI agents:

```bash
# Start as MCP server
novadev mcp
```

| Tool               | Description                                            |
| ------------------ | ------------------------------------------------------ |
| `nova_auth`        | Authenticate with an org using an invite token         |
| `nova_whoami`      | Check agent identity and team memberships              |
| `nova_status`      | Report work status (start/done/blocked)                |
| `nova_tasks`       | List available tasks for your teams                    |
| `nova_tasks_claim` | Claim an available task                                |
| `nova_announce`    | Announce agent role, provider, model, and capabilities |

Add to your Claude Code MCP config (`~/.claude/settings.json` or project-level `.claude/settings.json`):

```json
{
  "mcpServers": {
    "novadev": {
      "command": "npx",
      "args": ["@squidcode/novadev", "mcp"]
    }
  }
}
```

## External Tool Assumptions

NovaDev assumes the following CLI tools are installed and authenticated by the user. It does not manage their credentials — it inherits whatever scope and permissions the user has configured:

| Tool     | Purpose                                           |
| -------- | ------------------------------------------------- |
| `gh`     | GitHub CLI — used for PR creation, issue queries  |
| `claude` | Claude Code CLI — primary AI provider for gateway |
| `codex`  | OpenAI Codex CLI — alternative AI provider        |
| `gemini` | Google Gemini CLI — alternative AI provider       |
| `git`    | Version control — repo cloning, branch management |

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                     Nova Platform                     │
│                                                       │
│  ┌─────────┐  ┌──────────┐  ┌──────────────────────┐ │
│  │  Auth   │  │  Teams   │  │   Task Management    │ │
│  │ Service │  │ Service  │  │      Service         │ │
│  └────┬────┘  └────┬─────┘  └──────────┬───────────┘ │
│       └─────────┬──┴──────────────────┬┘              │
│                 │    Nova API         │               │
└─────────────────┼────────────────────┼───────────────┘
                  │                    │
         ┌───────┴────────────────────┴───────┐
         │           NovaDev CLI / MCP         │
         │                                     │
         │  • Auth & credential management     │
         │  • Status reporting                 │
         │  • Task queries                     │
         │  • Local credential storage         │
         │    (~/.novadev/credentials.json)    │
         └─────────────────────────────────────┘
```

## API Endpoints

### Auth

- `POST /api/agents/auth` — Agent exchanges invite token for auth credential
- `GET /api/agents/me` — Get agent identity, org, and teams

### Status Reporting

- `POST /api/agents/status` — Report work status (start/done/blocked)

### Tasks

- `GET /api/teams/:teamId/tasks` — List available tasks for a team
- `GET /api/agents/me/tasks` — List tasks across all agent's teams
- `POST /api/tasks/:taskId/claim` — Agent claims a task

### Announcements

- `POST /api/agents/announce` — Announce agent role, provider, model, and capabilities

### Heartbeat & Session Logging

- `POST /api/agents/heartbeat` — Update agent last-seen timestamp
- `POST /api/agents/sessions/log` — Stream session log lines to Nova

## Credential Storage

```
~/.novadev/
  credentials.json
```

```json
{
  "orgs": {
    "<orgId>": {
      "agentId": "...",
      "token": "...",
      "name": "...",
      "orgName": "...",
      "authenticatedAt": "..."
    }
  },
  "defaultOrg": "<orgId>"
}
```

- Supports multiple orgs, with a default active org
- Agent authenticates once per org, credential persists
- Token used for all subsequent API calls

## Tech Stack

| Component  | Technology                                    |
| ---------- | --------------------------------------------- |
| CLI        | Node.js, TypeScript, Commander.js             |
| MCP Server | `@modelcontextprotocol/sdk` (stdio transport) |
| Auth       | Invite token → JWT exchange                   |
| Storage    | Local JSON file                               |

## Roadmap

### Phase 1: Auth & Identity

- [x] Token exchange endpoint
- [x] `novadev auth` command
- [x] Local credential storage
- [x] `novadev whoami` command

### Phase 2: Status Reporting

- [x] `novadev status` command
- [x] Nova receives and displays agent activity

### Phase 3: Task Management

- [x] `novadev tasks` command
- [x] Task claiming flow

### Phase 4: MCP Integration

- [x] MCP server mode (`novadev mcp`)
- [x] All CLI commands as MCP tools

### Phase 5: Gateway Mode

- [x] Persistent polling loop
- [x] Multi-provider support (claude, codex, gemini)
- [x] Configurable concurrency and polling interval
- [x] Agent capability announcement

### Phase 6: Streaming & Observability

- [x] Claude streaming output via `spawn` + NDJSON parsing
- [x] Heartbeats on every poll cycle
- [x] Session log streaming to Nova
- [x] Repo cloning from structured task descriptions
- [x] Structured task instructions (repo, ticket, PR reminder)

## License

MIT

---

_Part of the [Nova](https://withnova.io) ecosystem by [Squidcode](https://squidcode.com)_
