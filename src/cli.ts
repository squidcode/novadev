#!/usr/bin/env node

import { Command } from 'commander';
import { authCommand } from './commands/auth.js';
import { whoamiCommand } from './commands/whoami.js';
import { statusCommand } from './commands/status.js';
import { tasksCommand } from './commands/tasks.js';
import { gatewayCommand } from './commands/gateway.js';
import { startMcpServer } from './mcp.js';

const program = new Command()
  .name('novadev')
  .description('Connect AI agents to your teams in the Nova system')
  .version('1.3.4');

program.addCommand(authCommand);
program.addCommand(whoamiCommand);
program.addCommand(statusCommand);
program.addCommand(tasksCommand);
program.addCommand(gatewayCommand);

program
  .command('mcp')
  .description('Start as an MCP server (stdio transport)')
  .action(async () => {
    await startMcpServer();
  });

program.parse();
