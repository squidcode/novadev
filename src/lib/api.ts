import { getApiUrl } from '../config.js';
import { getActiveCredential } from './credentials.js';

export class NovaApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'NovaApiError';
  }
}

async function request<T>(
  method: string,
  path: string,
  options?: { body?: unknown; token?: string },
): Promise<T> {
  const url = `${getApiUrl()}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const token = options?.token || getActiveCredential()?.token;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new NovaApiError(res.status, text);
  }

  return res.json() as Promise<T>;
}

export interface AuthResponse {
  agentId: string;
  orgId: string;
  orgName: string;
  token: string;
  name: string;
  teams: Array<{ id: string; name: string }>;
}

export interface AgentInfo {
  agentId: string;
  name: string;
  orgId: string;
  orgName: string;
  teams: Array<{ id: string; name: string }>;
  status: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  teamId: string;
  teamName: string;
  assigneeId: string | null;
  priority: string;
  createdAt: string;
}

export interface AnnouncePayload {
  role: string;
  provider: string;
  model: string;
  capabilities: string[];
}

export const api = {
  auth(inviteToken: string): Promise<AuthResponse> {
    return request<AuthResponse>('POST', '/api/agents/auth', {
      body: { inviteToken },
    });
  },

  me(): Promise<AgentInfo> {
    return request<AgentInfo>('GET', '/api/agents/me');
  },

  reportStatus(
    type: 'start' | 'done' | 'blocked',
    message: string,
    taskId?: string,
  ): Promise<{ ok: boolean; owned?: boolean }> {
    return request('POST', '/api/agents/status', {
      body: { type, message, taskId },
    });
  },

  getTask(taskId: string): Promise<Task> {
    return request('GET', `/api/tasks/${taskId}`);
  },

  tasks(teamId?: string): Promise<Task[]> {
    const path = teamId ? `/api/teams/${teamId}/tasks` : '/api/agents/me/tasks';
    return request<Task[]>('GET', path);
  },

  claimTask(taskId: string) {
    return request('POST', `/api/tasks/${taskId}/claim`);
  },

  unclaimTask(taskId: string, reason: string) {
    return request('POST', `/api/tasks/${taskId}/unclaim`, {
      body: { reason },
    });
  },

  announce(payload: AnnouncePayload) {
    return request('POST', '/api/agents/announce', { body: payload });
  },

  heartbeat(): Promise<{ ok: boolean }> {
    return request('POST', '/api/agents/heartbeat');
  },

  logSession(
    taskId: string | undefined,
    lines: Array<{ t: number; text: string }>,
    done?: boolean,
  ): Promise<{ ok: boolean }> {
    return request('POST', '/api/agents/sessions/log', {
      body: { taskId, lines, done },
    });
  },

  reportUsage(taskId: string, resultEvent: Record<string, unknown>): Promise<{ ok: boolean }> {
    return request('POST', '/api/agents/usage', {
      body: { taskId, resultEvent },
    });
  },

  pusherAuth(socketId: string, channelName: string): Promise<unknown> {
    return request('POST', '/api/agents/pusher/auth', {
      body: { socket_id: socketId, channel_name: channelName },
    });
  },
};
