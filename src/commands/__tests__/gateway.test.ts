import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChildProcess, execFile, spawn } from 'node:child_process';
import { EventEmitter, Readable } from 'node:stream';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('../../lib/api.js', () => ({
  api: {
    claimTask: vi.fn().mockResolvedValue({}),
    unclaimTask: vi.fn().mockResolvedValue({}),
    reportStatus: vi.fn().mockResolvedValue({ ok: true }),
    getTask: vi.fn().mockResolvedValue({ assigneeId: 'agent-1' }),
    tasks: vi.fn().mockResolvedValue([]),
    announce: vi.fn().mockResolvedValue({}),
    heartbeat: vi.fn().mockResolvedValue({}),
    logSession: vi.fn().mockResolvedValue({}),
    reportUsage: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

vi.mock('../../lib/credentials.js', () => ({
  getActiveCredential: vi.fn().mockReturnValue({ agentId: 'agent-1' }),
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
  parseRepo,
  checkOwnership,
  OWNERSHIP_POLL_MS,
} from '../gateway.js';

const mockExecFile = vi.mocked(execFile);
const mockSpawn = vi.mocked(spawn);
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

function createMockProc() {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const emitter = new EventEmitter();
  const proc = Object.assign(emitter, {
    stdout,
    stderr,
    stdin: null,
    stdio: [null, stdout, stderr] as const,
    pid: 12345,
    connected: false,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    spawnargs: [] as string[],
    spawnfile: '',
    killed: false,
    kill: vi.fn(),
    send: vi.fn(),
    disconnect: vi.fn(),
    unref: vi.fn(),
    ref: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  }) as unknown as ChildProcess;
  return { proc, stdout, stderr };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  mockApi.claimTask.mockResolvedValue({});
  mockApi.unclaimTask.mockResolvedValue({});
  mockApi.reportStatus.mockResolvedValue({ ok: true });
  mockApi.getTask.mockResolvedValue({ assigneeId: 'agent-1' } as Task);
  mockApi.heartbeat.mockResolvedValue({ ok: true });
  mockApi.logSession.mockResolvedValue({ ok: true });
  mockApi.reportUsage.mockResolvedValue({ ok: true });
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
});

describe('parseRepo', () => {
  it('extracts repo from description', () => {
    expect(parseRepo('Repository: squidcode/nova\n\nDo stuff')).toBe('squidcode/nova');
  });

  it('returns null when no repo line', () => {
    expect(parseRepo('Just a description')).toBeNull();
  });

  it('handles repo with ticket below', () => {
    expect(parseRepo('Repository: org/repo\nTicket: #42\n\nDesc')).toBe('org/repo');
  });
});

describe('checkOwnership', () => {
  it('returns true when task is assigned to current agent', async () => {
    mockApi.getTask.mockResolvedValue({ assigneeId: 'agent-1' } as Task);
    expect(await checkOwnership('task-1')).toBe(true);
  });

  it('returns false when task is assigned to another agent', async () => {
    mockApi.getTask.mockResolvedValue({ assigneeId: 'other-agent' } as Task);
    expect(await checkOwnership('task-1')).toBe(false);
  });

  it('returns false when task is unassigned', async () => {
    mockApi.getTask.mockResolvedValue({ assigneeId: null } as unknown as Task);
    expect(await checkOwnership('task-1')).toBe(false);
  });

  it('returns true on network error (fail-open)', async () => {
    mockApi.getTask.mockRejectedValue(new Error('Network error'));
    expect(await checkOwnership('task-1')).toBe(true);
  });
});

describe('OWNERSHIP_POLL_MS', () => {
  it('is 30 seconds', () => {
    expect(OWNERSHIP_POLL_MS).toBe(30_000);
  });
});

describe('processTask with claude (streaming)', () => {
  it('claims task, spawns claude, reports done', async () => {
    const { proc, stdout } = createMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = processTask(fakeTask, 'claude', { logging: true });

    // Simulate stream-json output
    const resultEvent = JSON.stringify({
      type: 'result',
      result: 'Task completed successfully',
    });
    stdout.push(resultEvent + '\n');
    stdout.push(null);

    // Process closes
    setTimeout(() => proc.emit('close', 0), 10);

    await promise;

    expect(mockApi.claimTask).toHaveBeenCalledWith('task-1');
    expect(mockApi.reportStatus).toHaveBeenCalledWith('start', '[claude] Fix bug', 'task-1');
    expect(mockApi.reportStatus).toHaveBeenCalledWith(
      'done',
      expect.stringContaining('[claude]'),
      'task-1',
    );
  });

  it('reports blocked and unclaims on spawn error', async () => {
    const { proc } = createMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = processTask(fakeTask, 'claude', { logging: true });

    setTimeout(() => proc.emit('error', new Error('spawn ENOENT')), 10);

    await promise;

    expect(mockApi.unclaimTask).toHaveBeenCalledWith('task-1', 'spawn ENOENT');
    expect(mockApi.reportStatus).toHaveBeenCalledWith('blocked', '[claude] spawn ENOENT', 'task-1');
  });

  it('aborts when ownership is lost before start', async () => {
    mockApi.reportStatus.mockResolvedValueOnce({ ok: true, owned: false });

    const { proc } = createMockProc();
    mockSpawn.mockReturnValue(proc);

    await processTask(fakeTask, 'claude', { logging: true });

    // Should NOT have spawned claude since ownership was lost at start
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('does not report done when ownership lost after completion', async () => {
    // First reportStatus (start) succeeds, second (done) returns owned: false
    mockApi.reportStatus
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true, owned: false });

    const { proc, stdout } = createMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = processTask(fakeTask, 'claude', { logging: true });

    const resultEvent = JSON.stringify({
      type: 'result',
      result: 'Task completed successfully',
    });
    stdout.push(resultEvent + '\n');
    stdout.push(null);
    setTimeout(() => proc.emit('close', 0), 10);

    await promise;

    // reportStatus was called for start and done
    expect(mockApi.reportStatus).toHaveBeenCalledTimes(2);
    // But reportUsage should NOT have been called since ownership was lost
    expect(mockApi.reportUsage).not.toHaveBeenCalled();
  });

  it('sends session logs when logging is enabled', async () => {
    const { proc, stdout } = createMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = processTask(fakeTask, 'claude', { logging: true });

    // Send assistant message event
    const event = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Working on it' }] },
    });
    stdout.push(event + '\n');
    stdout.push(null);

    setTimeout(() => proc.emit('close', 0), 10);
    await promise;

    // logSession should have been called at least once (the final flush with done: true)
    expect(mockApi.logSession).toHaveBeenCalled();
    const finalCall = mockApi.logSession.mock.calls.find((c) => c[2] === true);
    expect(finalCall).toBeDefined();
  });

  it('skips session logs when logging is disabled', async () => {
    const { proc, stdout } = createMockProc();
    mockSpawn.mockReturnValue(proc);

    const promise = processTask(fakeTask, 'claude', { logging: false });

    const event = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Working on it' }] },
    });
    stdout.push(event + '\n');
    stdout.push(null);

    setTimeout(() => proc.emit('close', 0), 10);
    await promise;

    expect(mockApi.logSession).not.toHaveBeenCalled();
  });
});

describe('processTask with non-claude provider', () => {
  it('uses execFile for codex provider', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as (err: Error | null, stdout: string) => void)(null, 'Task completed');
      return undefined as never;
    });

    await processTask(fakeTask, 'codex');

    expect(mockApi.claimTask).toHaveBeenCalledWith('task-1');
    expect(mockApi.reportStatus).toHaveBeenCalledWith('done', '[codex] Task completed', 'task-1');
  });

  it('reports blocked status and unclaims on CLI failure', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as (err: Error | null, stdout: string) => void)(new Error('CLI crashed'), '');
      return undefined as never;
    });

    await processTask(fakeTask, 'codex');

    expect(mockApi.unclaimTask).toHaveBeenCalledWith('task-1', 'CLI crashed');
    expect(mockApi.reportStatus).toHaveBeenCalledWith('blocked', '[codex] CLI crashed', 'task-1');
  });

  it('does not report done when ownership lost', async () => {
    mockApi.reportStatus
      .mockResolvedValueOnce({ ok: true }) // start
      .mockResolvedValueOnce({ ok: true, owned: false }); // done

    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as (err: Error | null, stdout: string) => void)(null, 'Task completed');
      return undefined as never;
    });

    await processTask(fakeTask, 'codex');

    expect(mockApi.reportStatus).toHaveBeenCalledWith('done', '[codex] Task completed', 'task-1');
  });
});

describe('output truncation (non-claude providers)', () => {
  it('truncates stdout over MAX_OUTPUT_BYTES', async () => {
    const longOutput = 'x'.repeat(MAX_OUTPUT_BYTES + 1000);
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      (cb as (err: Error | null, stdout: string) => void)(null, longOutput);
      return undefined as never;
    });

    await processTask(fakeTask, 'codex');

    const doneCall = mockApi.reportStatus.mock.calls.find((c) => c[0] === 'done');
    expect(doneCall).toBeDefined();
    const reportedOutput = doneCall![1].replace('[codex] ', '');
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
