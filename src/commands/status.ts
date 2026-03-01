import { Command } from 'commander';
import { api } from '../lib/api.js';
import { getActiveCredential } from '../lib/credentials.js';

const VALID_TYPES = ['start', 'done', 'blocked'] as const;
type StatusType = (typeof VALID_TYPES)[number];

export const statusCommand = new Command('status')
  .description('Report work status to Nova')
  .argument('<type>', 'Status type: start, done, or blocked')
  .argument('<message>', 'Status message')
  .option('-t, --task <taskId>', 'Associated task ID')
  .action(async (type: string, message: string, opts: { task?: string }) => {
    if (!getActiveCredential()) {
      console.error('Not authenticated. Run: novadev auth <token>');
      process.exit(1);
    }

    if (!VALID_TYPES.includes(type as StatusType)) {
      console.error(`Invalid status type "${type}". Use: ${VALID_TYPES.join(', ')}`);
      process.exit(1);
    }

    try {
      await api.reportStatus(type as StatusType, message, opts.task);
      console.log(`Reported: [${type}] ${message}`);
    } catch (err) {
      if (err instanceof Error) {
        console.error(`Failed to report status: ${err.message}`);
      }
      process.exit(1);
    }
  });
