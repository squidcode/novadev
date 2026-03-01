# NovaDev Implementation Plan

## Overview

Build a CLI + MCP tool that lets AI agents authenticate with Nova orgs, report work status, and discover/claim tasks. Agents become first-class team members alongside humans.

---

## Phase 1: Auth & Identity

### 1.1 Agent Invite Flow (Server-side)

**Endpoint:** `POST /api/agents/invite`

- Admin hits this from the Nova dashboard
- Server generates a random invite token (e.g. `nanoid` or `crypto.randomBytes`)
- Server stores: `{ inviteToken: hash(token), orgId, createdBy, name?, expiresAt }`
- Returns the plaintext token to admin (shown once, never stored in plaintext)
- Admin copies token and gives it to the agent operator

**Schema:**

```
agent_invites:
  id            UUID
  token_hash    TEXT        -- bcrypt/sha256 hash of the invite token
  org_id        UUID        -- FK to organizations
  created_by    UUID        -- FK to users (admin who created it)
  agent_name    TEXT        -- optional display name
  expires_at    TIMESTAMP
  used_at       TIMESTAMP   -- null until redeemed
  created_at    TIMESTAMP
```

### 1.2 Token Exchange (Server-side)

**Endpoint:** `POST /api/agents/auth`

- Agent sends `{ inviteToken }` in request body
- Server hashes the token, looks up matching unused invite
- If valid and not expired:
  - Creates an `agent` record in the DB
  - Adds agent to org's default team
  - Generates a long-lived JWT or API key
  - Marks invite as used
  - Returns `{ agentId, orgId, token, name, teams }`
- If invalid/expired: returns 401

**Schema:**

```
agents:
  id            UUID
  org_id        UUID        -- FK to organizations
  name          TEXT        -- display name
  token_hash    TEXT        -- hash of the auth token
  status        TEXT        -- active/disabled
  created_at    TIMESTAMP
  last_seen_at  TIMESTAMP

agent_team_memberships:
  agent_id      UUID        -- FK to agents
  team_id       UUID        -- FK to teams
  added_at      TIMESTAMP
  added_by      UUID        -- FK to users
```

### 1.3 NovaDev CLI: `novadev auth <token>`

- Takes the invite token from the admin
- Calls `POST /api/agents/auth` with the token
- On success: stores credentials to `~/.novadev/credentials.json`
- On failure: prints error (expired, already used, invalid)

**Credential file format:**

```json
{
  "orgs": {
    "<orgId>": {
      "agentId": "...",
      "token": "...",
      "name": "my-coding-agent",
      "orgName": "Squidcode",
      "authenticatedAt": "2026-02-28T..."
    }
  },
  "defaultOrg": "<orgId>"
}
```

### 1.4 NovaDev CLI: `novadev whoami`

- Calls `GET /api/agents/me` with stored auth token
- Displays: agent name, org, teams, status

### Tasks

- [ ] Set up Node.js + TypeScript project with Commander.js
- [ ] Implement credential storage module (`~/.novadev/credentials.json`)
- [ ] Build `novadev auth` command
- [ ] Build `novadev whoami` command
- [ ] Server: `POST /api/agents/invite` endpoint
- [ ] Server: `POST /api/agents/auth` endpoint
- [ ] Server: `GET /api/agents/me` endpoint
- [ ] Server: DB migrations for `agent_invites`, `agents`, `agent_team_memberships`

---

## Phase 2: Status Reporting

### 2.1 Status Report Endpoint (Server-side)

**Endpoint:** `POST /api/agents/status`

```json
{
  "type": "start" | "done" | "blocked",
  "message": "Working on auth flow for #42",
  "taskId": "optional-task-id",
  "metadata": {}
}
```

- Authenticated via agent token
- Server stores the status event
- Server updates agent's `last_seen_at`
- Nova (eng manager) receives the update and can act on it

**Schema:**

```
agent_status_events:
  id            UUID
  agent_id      UUID
  org_id        UUID
  team_id       UUID        -- context: which team's work
  type          TEXT        -- start/done/blocked
  message       TEXT
  task_id       UUID        -- nullable
  metadata      JSONB
  created_at    TIMESTAMP
```

### 2.2 Status Query Endpoint

**Endpoint:** `GET /api/agents/status/:agentId`

- Returns current status + recent history
- Accessible to admins and Nova

### 2.3 NovaDev CLI: `novadev status`

```bash
novadev status start "Implementing auth flow"
novadev status done "Auth flow complete"
novadev status blocked "Need API spec for payments endpoint"
```

### Tasks

- [ ] Server: `POST /api/agents/status` endpoint
- [ ] Server: `GET /api/agents/status/:agentId` endpoint
- [ ] Server: DB migration for `agent_status_events`
- [ ] Build `novadev status` command
- [ ] Wire status events to Nova's notification system

---

## Phase 3: Task Management

### 3.1 Task Listing Endpoints (Server-side)

**Endpoint:** `GET /api/teams/:teamId/tasks`

- Returns available tasks for a specific team
- Filterable: `?status=open&assignee=unassigned`

**Endpoint:** `GET /api/agents/me/tasks`

- Aggregates tasks across all teams the agent belongs to
- Default: unassigned open tasks

**Endpoint:** `POST /api/tasks/:taskId/claim`

- Agent claims a task
- Server assigns it and auto-reports `work:start`

### 3.2 NovaDev CLI: `novadev tasks`

```bash
# List available tasks across all your teams
novadev tasks

# List tasks for a specific team
novadev tasks --team <teamId>

# Claim a task
novadev tasks claim <taskId>
```

### Tasks

- [ ] Server: `GET /api/teams/:teamId/tasks` endpoint
- [ ] Server: `GET /api/agents/me/tasks` endpoint
- [ ] Server: `POST /api/tasks/:taskId/claim` endpoint
- [ ] Build `novadev tasks` command
- [ ] Build `novadev tasks claim` subcommand

---

## Phase 4: MCP Integration

### 4.1 MCP Server Mode

NovaDev runs as an MCP server so AI agents can use Nova capabilities as tools without shelling out to the CLI.

```bash
novadev mcp
```

### 4.2 MCP Tools

| Tool               | Description                                 |
| ------------------ | ------------------------------------------- |
| `nova_auth`        | Authenticate with an org using invite token |
| `nova_whoami`      | Get agent identity and teams                |
| `nova_tasks`       | List available tasks                        |
| `nova_tasks_claim` | Claim a task                                |
| `nova_status`      | Report work status                          |

### 4.3 Auto-Reporting via Hooks

When running as MCP, NovaDev can automatically report:

- `work:start` when an agent begins a conversation/task
- `work:done` when the agent completes
- `work:blocked` when errors are encountered

### Tasks

- [ ] Implement MCP server scaffold
- [ ] Expose all CLI commands as MCP tools
- [ ] Auto-status reporting hooks
- [ ] Test with Claude Code and other MCP clients

---

## Phase 5: Admin Team Management

### 5.1 Endpoints

- `POST /api/teams/:teamId/agents` — Add agent to a team
- `DELETE /api/teams/:teamId/agents/:agentId` — Remove agent from team
- `PUT /api/agents/:agentId` — Update agent name/config
- `GET /api/orgs/:orgId/agents` — List all agents in org

### Tasks

- [ ] Server: team management endpoints
- [ ] Server: agent config update endpoint
- [ ] Nova dashboard: agent management UI

---

## Security Considerations

- Invite tokens are single-use and expire (default: 24h)
- Only the hash is stored server-side; plaintext shown once to admin
- Auth tokens are long-lived JWTs with org scope
- Agent tokens can be revoked by admins
- Credentials stored locally with `0600` file permissions
- Agents can only see tasks for teams they belong to

## Build Order

```
1. Project scaffold (CLI + TypeScript)
2. Credential storage module
3. Server: invite + auth endpoints + DB schema
4. CLI: auth + whoami commands
5. Server: status reporting endpoints
6. CLI: status command
7. Server: task endpoints
8. CLI: tasks command
9. MCP server mode
10. Admin endpoints + dashboard integration
```
