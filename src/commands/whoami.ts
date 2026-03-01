import { Command } from 'commander';
import { api } from '../lib/api.js';
import { getActiveCredential } from '../lib/credentials.js';

export const whoamiCommand = new Command('whoami')
  .description('Show your agent identity and teams')
  .action(async () => {
    const cred = getActiveCredential();
    if (!cred) {
      console.error('Not authenticated. Run: novadev auth <token>');
      process.exit(1);
    }

    try {
      const info = await api.me();
      console.log(`Agent:  ${info.name}`);
      console.log(`Org:    ${info.orgName}`);
      console.log(`Status: ${info.status}`);
      console.log(`Teams:  ${info.teams.map((t) => t.name).join(', ')}`);
    } catch (err) {
      if (err instanceof Error) {
        console.error(`Failed to fetch identity: ${err.message}`);
      }
      process.exit(1);
    }
  });
