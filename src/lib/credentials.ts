import fs from 'node:fs';
import { NOVADEV_DIR, CREDENTIALS_FILE } from '../config.js';

export interface OrgCredential {
  agentId: string;
  token: string;
  name: string;
  orgName: string;
  authenticatedAt: string;
}

export interface CredentialStore {
  orgs: Record<string, OrgCredential>;
  defaultOrg: string | null;
}

function ensureDir(): void {
  if (!fs.existsSync(NOVADEV_DIR)) {
    fs.mkdirSync(NOVADEV_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadCredentials(): CredentialStore {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    return { orgs: {}, defaultOrg: null };
  }
  const raw = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
  return JSON.parse(raw) as CredentialStore;
}

export function saveCredentials(store: CredentialStore): void {
  ensureDir();
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(store, null, 2), {
    mode: 0o600,
  });
}

export function getActiveCredential(): (OrgCredential & { orgId: string }) | null {
  const store = loadCredentials();
  const orgId = store.defaultOrg;
  if (!orgId || !store.orgs[orgId]) return null;
  return { ...store.orgs[orgId], orgId };
}

export function setCredential(orgId: string, credential: OrgCredential): void {
  const store = loadCredentials();
  store.orgs[orgId] = credential;
  if (!store.defaultOrg) {
    store.defaultOrg = orgId;
  }
  saveCredentials(store);
}
