import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { api } from './lib/api.js';
import { getActiveCredential, setCredential } from './lib/credentials.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'novadev',
    version: '0.1.0',
  });

  server.registerTool(
    'nova_auth',
    {
      title: 'Authenticate with Nova',
      description: 'Authenticate with a Nova organization using an invite token (one-time setup)',
      inputSchema: {
        token: z.string().describe('Invite token from your org admin'),
      },
    },
    async ({ token }) => {
      const res = await api.auth(token);

      setCredential(res.orgId, {
        agentId: res.agentId,
        token: res.token,
        name: res.name,
        orgName: res.orgName,
        authenticatedAt: new Date().toISOString(),
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Authenticated as "${res.name}" in ${res.orgName}. Teams: ${res.teams.map((t) => t.name).join(', ')}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    'nova_whoami',
    {
      title: 'Check Nova identity',
      description: 'Show your agent identity, organization, and team memberships',
    },
    async () => {
      const cred = getActiveCredential();
      if (!cred) {
        return {
          content: [{ type: 'text' as const, text: 'Not authenticated. Use nova_auth first.' }],
          isError: true,
        };
      }

      const info = await api.me();
      return {
        content: [
          {
            type: 'text' as const,
            text: [
              `Agent:  ${info.name}`,
              `Org:    ${info.orgName}`,
              `Status: ${info.status}`,
              `Teams:  ${info.teams.map((t) => t.name).join(', ')}`,
            ].join('\n'),
          },
        ],
      };
    },
  );

  server.registerTool(
    'nova_status',
    {
      title: 'Report work status',
      description:
        'Report work status to Nova (the engineering manager). Use "start" when beginning work, "done" when finished, "blocked" when hitting an issue.',
      inputSchema: {
        type: z.enum(['start', 'done', 'blocked']).describe('Status type'),
        message: z.string().describe('Status message describing what you are working on'),
        taskId: z.string().optional().describe('Associated task ID (optional)'),
      },
    },
    async ({ type, message, taskId }) => {
      const cred = getActiveCredential();
      if (!cred) {
        return {
          content: [{ type: 'text' as const, text: 'Not authenticated. Use nova_auth first.' }],
          isError: true,
        };
      }

      await api.reportStatus(type, message, taskId);
      return {
        content: [{ type: 'text' as const, text: `Reported: [${type}] ${message}` }],
      };
    },
  );

  server.registerTool(
    'nova_tasks',
    {
      title: 'List available tasks',
      description: 'List available tasks for your teams. Optionally filter by team ID.',
      inputSchema: {
        teamId: z.string().optional().describe('Filter by team ID (optional)'),
      },
    },
    async ({ teamId }) => {
      const cred = getActiveCredential();
      if (!cred) {
        return {
          content: [{ type: 'text' as const, text: 'Not authenticated. Use nova_auth first.' }],
          isError: true,
        };
      }

      const tasks = await api.tasks(teamId);
      if (tasks.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No tasks available.' }],
        };
      }

      const lines = tasks.map((t) => {
        const assignee = t.assigneeId ? '[assigned]' : '[open]';
        return `${t.id}  ${assignee}  ${t.title}  (${t.teamName})`;
      });

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    },
  );

  server.registerTool(
    'nova_tasks_claim',
    {
      title: 'Claim a task',
      description: 'Claim an available task to work on. This assigns the task to you.',
      inputSchema: {
        taskId: z.string().describe('The task ID to claim'),
      },
    },
    async ({ taskId }) => {
      const cred = getActiveCredential();
      if (!cred) {
        return {
          content: [{ type: 'text' as const, text: 'Not authenticated. Use nova_auth first.' }],
          isError: true,
        };
      }

      await api.claimTask(taskId);
      return {
        content: [{ type: 'text' as const, text: `Claimed task ${taskId}` }],
      };
    },
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
