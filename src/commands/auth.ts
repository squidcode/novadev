import { Command } from 'commander';
import { api } from '../lib/api.js';
import { setCredential } from '../lib/credentials.js';

export const authCommand = new Command('auth')
  .description('Authenticate with a Nova organization using an invite token')
  .argument('<token>', 'Invite token from your org admin')
  .action(async (token: string) => {
    try {
      console.log('Authenticating with Nova...');
      const res = await api.auth(token);

      setCredential(res.orgId, {
        agentId: res.agentId,
        token: res.token,
        name: res.name,
        orgName: res.orgName,
        authenticatedAt: new Date().toISOString(),
      });

      console.log(`Authenticated as "${res.name}" in ${res.orgName}`);
      console.log(`Teams: ${res.teams.map((t) => t.name).join(', ')}`);
    } catch (err) {
      if (err instanceof Error) {
        console.error(`Authentication failed: ${err.message}`);
      }
      process.exit(1);
    }
  });
