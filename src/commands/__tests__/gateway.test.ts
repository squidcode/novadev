import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('../../lib/api.js', () => ({
  api: {
    claimTask: vi.fn().mockResolvedValue({}),
    reportStatus: vi.fn().mockResolvedValue({}),
    tasks: vi.fn().mockResolvedValue([]),
    announce: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../lib/credentials.js', () => ({
  getActiveCredential: vi.fn(),
}));

vi.mock('../../config.js', () => ({
  getApiUrl: () => 'https://test.api',
  NOVADEV_DIR: '/tmp/.novadev',
  CREDENTIALS_FILE: '/tmp/.novadev/credentials.json',
}));

import { api, Task } from '../../lib/api.js';
import {
  verifyProvider,
  processTask,
  MAX_OUTPUT_BYTES,
  PROVIDERS,
  AGENT_CAPABILITIES,
} from '../gateway.js';

const mockExecFile = vi.mocked(execFile);
const mockApi = vi.mocked(api);

const fakeTask: Task = {
  id: 'task-1',
  title: 'Fix bug',
  description: 'Fix the login bug',
  status: 'open',
  teamId: 'team-1',
  teamName: 'Alpha',
  assigneeId: null,
  priority: 'high',
  createdAt: '2025-01-01',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.claimTask.mockResolvedValue({});
  mockApi.reportStatus.mockResolvedValue(undefined as never);
});

describe('provider validation', () => {
  it('rejects unknown provider via PROVIDERS lookup', () => {
    expect(PROVIDERS['nonexistent']).toBeUndefined();
  });
});

describe('verifyProvider', () => {
  it('resolves with version string when command exists', async () => {
    mockExecFile.mockImplementation((_cmd, _args, cb) => {
      (cb as (err: Error | null, stdout: string) => void)(null, 'claude-code 1.2.3\n');
      return undefined as never;
    });

    await expect(verifyProvider('claude')).resolves.toBe('claude-code 1.2.3');
    expect(mockExecFile).toHaveBeenCalledWith('claude', ['--version'], expect.any(Function));
  });

  it('rejects when command not found', async () => {
    mockExecFile.mockImplementation((_cmd, _args, cb) => {
      (cb as (err: Error | null, stdout: string) => void)(new Error('ENOENT'), '');
      return undefined as never;
    });

    await expect(verifyProvider('claude')).rejects.toThrow('not installed or not in PATH');
  });

  it('resolves with empty string when stdout is empty', async () => {
    mockExecFile.mockImplementation((_cmd, _args, cb) => {
      (cb as (err: Error | null, stdout: string) => void)(null, '');
      return undefined as never;
    });

    await expect(verifyProvider('claude')).resolves.toBe('');
  });
});

describe('processTask', () => {
  it('claims task, reports start, runs provider, reports done', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as (err: Error | null, stdout: string) => void)(null, 'Task completed');
      return undefined as never;
    });

    await processTask(fakeTask, 'claude');

    expect(mockApi.claimTask).toHaveBeenCalledWith('task-1');
    expect(mockApi.reportStatus).toHaveBeenCalledWith('start', '[claude] Fix bug', 'task-1');
    expect(mockApi.reportStatus).toHaveBeenCalledWith('done', '[claude] Task completed', 'task-1');
  });

  it('reports blocked status on CLI failure', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as (err: Error | null, stdout: string) => void)(new Error('CLI crashed'), '');
      return undefined as never;
    });

    await processTask(fakeTask, 'claude');

    expect(mockApi.reportStatus).toHaveBeenCalledWith('blocked', '[claude] CLI crashed', 'task-1');
  });
});

describe('output truncation', () => {
  it('truncates stdout over MAX_OUTPUT_BYTES', async () => {
    const longOutput = 'x'.repeat(MAX_OUTPUT_BYTES + 1000);
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as (err: Error | null, stdout: string) => void)(null, longOutput);
      return undefined as never;
    });

    await processTask(fakeTask, 'claude');

    const doneCall = mockApi.reportStatus.mock.calls.find((c) => c[0] === 'done');
    expect(doneCall).toBeDefined();
    // The message is "[claude] " + truncated output
    const reportedOutput = doneCall![1].replace('[claude] ', '');
    expect(reportedOutput.length).toBe(MAX_OUTPUT_BYTES);
  });
});

describe('AGENT_CAPABILITIES', () => {
  it('is a non-empty array of strings', () => {
    expect(AGENT_CAPABILITIES.length).toBeGreaterThan(0);
    for (const cap of AGENT_CAPABILITIES) {
      expect(typeof cap).toBe('string');
    }
  });
});

describe('announcement at startup', () => {
  it('api.announce is callable with expected payload shape', () => {
    const payload = {
      role: 'Senior full-stack engineer',
      provider: 'claude',
      model: 'claude-code 1.2.3',
      capabilities: AGENT_CAPABILITIES,
    };

    mockApi.announce(payload);

    expect(mockApi.announce).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'Senior full-stack engineer',
        provider: 'claude',
        model: 'claude-code 1.2.3',
        capabilities: expect.arrayContaining(['Full-stack web development']),
      }),
    );
  });
});
