import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../credentials.js', () => ({
  getActiveCredential: vi.fn(),
}));

vi.mock('../../config.js', () => ({
  getApiUrl: () => 'https://test.api',
}));

import { api, NovaApiError } from '../api.js';
import { getActiveCredential } from '../credentials.js';

const mockCredential = vi.mocked(getActiveCredential);

function mockFetch(body: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  });
  global.fetch = fn;
  return fn;
}

beforeEach(() => {
  vi.restoreAllMocks();
  mockCredential.mockReturnValue(null);
});

describe('request helper', () => {
  it('includes auth header when credential exists', async () => {
    mockCredential.mockReturnValue({
      agentId: 'a1',
      token: 'tok-123',
      name: 'bot',
      orgName: 'org',
      orgId: 'o1',
      authenticatedAt: '',
    });
    const fetchSpy = mockFetch({ agentId: 'a1' });

    await api.me();

    const headers = fetchSpy.mock.calls[0][1].headers;
    expect(headers['Authorization']).toBe('Bearer tok-123');
  });

  it('omits auth header when no credential', async () => {
    const fetchSpy = mockFetch({ agentId: 'a1' });

    await api.me();

    const headers = fetchSpy.mock.calls[0][1].headers;
    expect(headers['Authorization']).toBeUndefined();
  });
});

describe('error handling', () => {
  it('throws NovaApiError on non-OK response', async () => {
    mockFetch('Forbidden', false, 403);

    await expect(api.me()).rejects.toThrow(NovaApiError);
    await expect(api.me()).rejects.toMatchObject({ status: 403, message: 'Forbidden' });
  });
});

describe('api.auth', () => {
  it('POSTs to /api/agents/auth with invite token', async () => {
    const fetchSpy = mockFetch({
      agentId: 'a1',
      token: 't',
      orgId: 'o',
      orgName: 'O',
      name: 'n',
      teams: [],
    });

    await api.auth('invite-abc');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://test.api/api/agents/auth',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ inviteToken: 'invite-abc' }),
      }),
    );
  });
});

describe('api.me', () => {
  it('GETs /api/agents/me', async () => {
    const fetchSpy = mockFetch({ agentId: 'a1' });

    await api.me();

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://test.api/api/agents/me',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('api.reportStatus', () => {
  it('POSTs with type, message, and taskId', async () => {
    const fetchSpy = mockFetch({});

    await api.reportStatus('start', 'working', 'task-1');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://test.api/api/agents/status',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ type: 'start', message: 'working', taskId: 'task-1' }),
      }),
    );
  });
});

describe('api.tasks', () => {
  it('GETs /api/agents/me/tasks when no teamId', async () => {
    const fetchSpy = mockFetch([]);

    await api.tasks();

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://test.api/api/agents/me/tasks',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('GETs /api/teams/:id/tasks when teamId provided', async () => {
    const fetchSpy = mockFetch([]);

    await api.tasks('team-1');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://test.api/api/teams/team-1/tasks',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});

describe('api.claimTask', () => {
  it('POSTs to /api/tasks/:id/claim', async () => {
    const fetchSpy = mockFetch({});

    await api.claimTask('task-42');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://test.api/api/tasks/task-42/claim',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('api.announce', () => {
  it('POSTs to /api/agents/announce with payload', async () => {
    const fetchSpy = mockFetch({});
    const payload = {
      role: 'Senior full-stack engineer',
      provider: 'claude',
      model: 'claude-code 1.0.0',
      capabilities: ['Full-stack web development'],
    };

    await api.announce(payload);

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://test.api/api/agents/announce',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    );
  });
});
