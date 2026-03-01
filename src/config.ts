import path from 'node:path';
import os from 'node:os';

export const NOVADEV_DIR = path.join(os.homedir(), '.novadev');
export const CREDENTIALS_FILE = path.join(NOVADEV_DIR, 'credentials.json');

export const DEFAULT_API_URL = 'https://api.nova.squidcode.com';

export function getApiUrl(): string {
  return process.env.NOVA_API_URL || DEFAULT_API_URL;
}
