import { Command } from 'commander';
import { execFile } from 'node:child_process';
import { api, AnnouncePayload, Task } from '../lib/api.js';
import { getActiveCredential } from '../lib/credentials.js';

export const MAX_OUTPUT_BYTES = 4096;

export const PROVIDERS: Record<
  string,
  { command: string; buildArgs: (prompt: string) => string[] }
> = {
  claude: { command: 'claude', buildArgs: (p) => ['-p', p] },
  codex: { command: 'codex', buildArgs: (p) => ['-q', p] },
  gemini: { command: 'gemini', buildArgs: (p) => ['-p', p] },
};

function timestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function log(msg: string): void {
  console.log(`[${timestamp()}] ${msg}`);
}

export const AGENT_CAPABILITIES = [
  'Proficient in all programming languages',
  'Full-stack web development',
  'API design and implementation',
  'Database design and query optimization',
  'Code review and refactoring',
  'Bug diagnosis and resolution',
  'Testing and CI/CD pipelines',
  'System architecture and infrastructure',
];

export function verifyProvider(provider: string): Promise<string> {
  const { command } = PROVIDERS[provider];
  return new Promise((resolve, reject) => {
    execFile(command, ['--version'], (err, stdout) => {
      if (err) {
        reject(new Error(`"${command}" is not installed or not in PATH`));
      } else {
        resolve((stdout ?? '').trim());
      }
    });
  });
}

export function runProvider(provider: string, prompt: string): Promise<string> {
  const { command, buildArgs } = PROVIDERS[provider];
  const args = buildArgs(prompt);
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: MAX_OUTPUT_BYTES * 2 }, (err, stdout) => {
      if (err) {
        reject(err);
      } else {
        resolve(stdout.slice(0, MAX_OUTPUT_BYTES));
      }
    });
  });
}

export async function processTask(task: Task, provider: string): Promise<void> {
  const label = `[${task.id}]`;

  try {
    await api.claimTask(task.id);
    log(`Claiming: "${task.title}" (${task.id})`);

    await api.reportStatus('start', `[${provider}] ${task.title}`, task.id);

    const prompt = `Task: ${task.title}\n\n${task.description}`;
    const { command, buildArgs } = PROVIDERS[provider];
    log(`${label} Running: ${command} ${buildArgs('...').join(' ')}`);

    const startTime = Date.now();
    const output = await runProvider(provider, prompt);
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    await api.reportStatus('done', `[${provider}] ${output}`, task.id);
    log(`${label} Done (${elapsed}s)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await api.reportStatus('blocked', `[${provider}] ${message}`, task.id).catch(() => {});
    log(`${label} Error: ${message}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const gatewayCommand = new Command('gateway')
  .description('Run a persistent polling loop that claims and solves tasks via an AI CLI')
  .option('-i, --interval <seconds>', 'Polling interval in seconds', '300')
  .option('-c, --concurrency <n>', 'Max parallel tasks', '1')
  .option('-p, --provider <name>', `AI CLI to use: ${Object.keys(PROVIDERS).join(', ')}`, 'claude')
  .action(async (opts: { interval: string; concurrency: string; provider: string }) => {
    if (!getActiveCredential()) {
      console.error('Not authenticated. Run: novadev auth <token>');
      process.exit(1);
    }

    const provider = opts.provider;
    if (!PROVIDERS[provider]) {
      console.error(
        `Unknown provider "${provider}". Available: ${Object.keys(PROVIDERS).join(', ')}`,
      );
      process.exit(1);
    }

    const interval = parseInt(opts.interval, 10) * 1000;
    const concurrency = parseInt(opts.concurrency, 10);

    let model = '';
    try {
      model = await verifyProvider(provider);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    const payload: AnnouncePayload = {
      role: 'Senior full-stack engineer',
      provider,
      model,
      capabilities: AGENT_CAPABILITIES,
    };

    try {
      await api.announce(payload);
      log(`Announced to Nova: provider=${provider} model=${model || '(unknown)'}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Announce failed (non-fatal): ${message}`);
    }

    log(
      `Gateway started. Provider: ${provider}. Polling every ${opts.interval}s. Concurrency: ${concurrency}. Ctrl+C to stop.`,
    );

    let shutdownRequested = false;
    let activeTasks = 0;

    process.on('SIGINT', () => {
      if (shutdownRequested) process.exit(1);
      shutdownRequested = true;
      log(`Shutting down... waiting for ${activeTasks} active task(s)`);
    });

    while (!shutdownRequested) {
      log('Polling for tasks...');

      try {
        const tasks = await api.tasks();
        const available = tasks.filter((t) => !t.assigneeId);

        if (available.length === 0) {
          log('No tasks available. Waiting...');
        } else {
          log(`Found ${available.length} task(s)`);

          const slots = concurrency - activeTasks;
          const batch = available.slice(0, slots);

          for (const task of batch) {
            activeTasks++;
            processTask(task, provider).finally(() => {
              activeTasks--;
            });
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`Poll error: ${message}`);
      }

      await sleep(interval);
    }

    // Wait for active tasks to finish
    while (activeTasks > 0) {
      await sleep(500);
    }

    log('Gateway stopped.');
  });
