import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs');
vi.mock('../../config.js', () => ({
  NOVADEV_DIR: '/home/test/.novadev',
  CREDENTIALS_FILE: '/home/test/.novadev/credentials.json',
}));

import fs from 'node:fs';
import {
  loadCredentials,
  saveCredentials,
  getActiveCredential,
  setCredential,
} from '../credentials.js';

const mockFs = vi.mocked(fs);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadCredentials', () => {
  it('returns empty store when file does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);

    const store = loadCredentials();

    expect(store).toEqual({ orgs: {}, defaultOrg: null });
  });

  it('parses JSON when file exists', () => {
    const data = {
      orgs: { o1: { agentId: 'a1', token: 't', name: 'n', orgName: 'O', authenticatedAt: '' } },
      defaultOrg: 'o1',
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(data));

    const store = loadCredentials();

    expect(store).toEqual(data);
  });
});

describe('saveCredentials', () => {
  it('creates dir if missing and writes JSON with 0o600 permissions', () => {
    mockFs.existsSync.mockReturnValue(false);
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.writeFileSync.mockReturnValue(undefined);

    const store = { orgs: {}, defaultOrg: null };
    saveCredentials(store);

    expect(mockFs.mkdirSync).toHaveBeenCalledWith('/home/test/.novadev', {
      recursive: true,
      mode: 0o700,
    });
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      '/home/test/.novadev/credentials.json',
      JSON.stringify(store, null, 2),
      { mode: 0o600 },
    );
  });
});

describe('getActiveCredential', () => {
  it('returns null when no default org', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ orgs: {}, defaultOrg: null }));

    expect(getActiveCredential()).toBeNull();
  });

  it('returns credential with orgId when set', () => {
    const cred = {
      agentId: 'a1',
      token: 'tok',
      name: 'bot',
      orgName: 'Org',
      authenticatedAt: '2025-01-01',
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ orgs: { o1: cred }, defaultOrg: 'o1' }));

    const result = getActiveCredential();

    expect(result).toEqual({ ...cred, orgId: 'o1' });
  });
});

describe('setCredential', () => {
  it('adds credential to store', () => {
    const existing = {
      orgs: { o1: { agentId: 'a1', token: 't1', name: 'n1', orgName: 'O1', authenticatedAt: '' } },
      defaultOrg: 'o1',
    };
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify(existing));
    mockFs.writeFileSync.mockReturnValue(undefined);

    const newCred = { agentId: 'a2', token: 't2', name: 'n2', orgName: 'O2', authenticatedAt: '' };
    setCredential('o2', newCred);

    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
    expect(written.orgs.o2).toEqual(newCred);
    expect(written.defaultOrg).toBe('o1'); // unchanged — already had a default
  });

  it('sets defaultOrg on first credential', () => {
    mockFs.existsSync.mockReturnValue(false);
    mockFs.mkdirSync.mockReturnValue(undefined);
    mockFs.writeFileSync.mockReturnValue(undefined);

    const cred = { agentId: 'a1', token: 't', name: 'n', orgName: 'O', authenticatedAt: '' };
    setCredential('o1', cred);

    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string);
    expect(written.defaultOrg).toBe('o1');
  });
});
