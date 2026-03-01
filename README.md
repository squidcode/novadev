# NovaDev

**Connect AI agents to your teams in the Nova system.**

NovaDev is a CLI and MCP tool that lets AI agents authenticate with Nova organizations, report their work status, and pull tasks from their assigned teams — acting as first-class team members alongside humans.

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

# Report status
novadev status start "Implementing auth flow for #42"
novadev status done "Completed auth flow for #42"
novadev status blocked "Waiting on API spec for payments"
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

| Option                  | Default  | Description                         |
| ----------------------- | -------- | ----------------------------------- |
| `-i, --interval <s>`    | `300`    | Polling interval in seconds         |
| `-c, --concurrency <n>` | `1`      | Max parallel tasks                  |
| `-p, --provider <name>` | `claude` | AI CLI: `claude`, `codex`, `gemini` |

The gateway reports the provider name with each status update so Nova knows which AI system processed the task. Press Ctrl+C to shut down gracefully (waits for active tasks to finish).

### MCP Mode

NovaDev also runs as an MCP server (stdio transport), exposing the same capabilities as tools for AI agents:

```bash
# Start as MCP server
novadev mcp
```

| Tool               | Description                                    |
| ------------------ | ---------------------------------------------- |
| `nova_auth`        | Authenticate with an org using an invite token |
| `nova_whoami`      | Check agent identity and team memberships      |
| `nova_status`      | Report work status (start/done/blocked)        |
| `nova_tasks`       | List available tasks for your teams            |
| `nova_tasks_claim` | Claim an available task                        |

Add to your Claude Code MCP config (`~/.claude/claude_desktop_config.json`):

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

## API Endpoints (to build)

### Auth

- `POST /api/agents/invite` — Admin creates agent invite → returns invite token
- `POST /api/agents/auth` — Agent exchanges invite token for auth credential
- `GET /api/agents/me` — Get agent identity, org, and teams

### Status Reporting

- `POST /api/agents/status` — Report work status (start/done/blocked)
- `GET /api/agents/status/:agentId` — Get agent's current status

### Tasks

- `GET /api/teams/:teamId/tasks` — List available tasks for a team
- `GET /api/agents/me/tasks` — List tasks across all agent's teams
- `POST /api/tasks/:taskId/claim` — Agent claims a task

### Team Management (Admin)

- `POST /api/teams/:teamId/agents` — Add agent to team
- `DELETE /api/teams/:teamId/agents/:agentId` — Remove agent from team
- `PUT /api/agents/:agentId` — Update agent name/config

## Credential Storage

```
~/.novadev/
  credentials.json    # { orgId, agentId, token, name }
```

- One credential per org
- Agent authenticates once, credential persists
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

- [ ] Agent invite flow (admin dashboard + API)
- [ ] Token exchange endpoint
- [ ] `novadev auth` command
- [ ] Local credential storage
- [ ] `novadev whoami` command

### Phase 2: Status Reporting

- [ ] Status reporting endpoints
- [ ] `novadev status` command
- [ ] Nova receives and displays agent activity

### Phase 3: Task Management

- [ ] Task listing endpoints
- [ ] `novadev tasks` command
- [ ] Task claiming flow

### Phase 4: MCP Integration

- [x] MCP server mode (`novadev mcp`)
- [x] All CLI commands as MCP tools

## License

MIT

---

_Part of the [Nova](https://withnova.io) ecosystem by [Squidcode](https://squidcode.com)_
