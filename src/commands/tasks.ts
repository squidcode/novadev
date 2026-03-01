import { Command } from 'commander';
import { api, Task } from '../lib/api.js';
import { getActiveCredential } from '../lib/credentials.js';

function requireAuth(): void {
  if (!getActiveCredential()) {
    console.error('Not authenticated. Run: novadev auth <token>');
    process.exit(1);
  }
}

function printTasks(tasks: Task[]): void {
  if (tasks.length === 0) {
    console.log('No tasks available.');
    return;
  }

  for (const task of tasks) {
    const assignee = task.assigneeId ? `[assigned]` : '[open]';
    console.log(`  ${task.id}  ${assignee}  ${task.title}  (${task.teamName})`);
  }
}

export const tasksCommand = new Command('tasks')
  .description('List available tasks for your teams')
  .option('--team <teamId>', 'Filter by team ID')
  .action(async (opts: { team?: string }) => {
    requireAuth();

    try {
      const tasks = await api.tasks(opts.team);
      printTasks(tasks);
    } catch (err) {
      if (err instanceof Error) {
        console.error(`Failed to fetch tasks: ${err.message}`);
      }
      process.exit(1);
    }
  });

tasksCommand
  .command('claim')
  .description('Claim a task')
  .argument('<taskId>', 'Task ID to claim')
  .action(async (taskId: string) => {
    requireAuth();

    try {
      await api.claimTask(taskId);
      console.log(`Claimed task ${taskId}`);
    } catch (err) {
      if (err instanceof Error) {
        console.error(`Failed to claim task: ${err.message}`);
      }
      process.exit(1);
    }
  });

tasksCommand
  .command('unclaim')
  .description('Release a claimed task back to open')
  .argument('<taskId>', 'Task ID to unclaim')
  .argument('[reason]', 'Reason for unclaiming')
  .action(async (taskId: string, reason?: string) => {
    requireAuth();

    try {
      await api.unclaimTask(taskId, reason || 'Manual unclaim');
      console.log(`Unclaimed task ${taskId}`);
    } catch (err) {
      if (err instanceof Error) {
        console.error(`Failed to unclaim task: ${err.message}`);
      }
      process.exit(1);
    }
  });
