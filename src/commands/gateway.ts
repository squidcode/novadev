import { Command } from 'commander';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { api, AnnouncePayload, Task } from '../lib/api.js';
import { getActiveCredential } from '../lib/credentials.js';

export const MAX_OUTPUT_BYTES = 4096;
export const OWNERSHIP_POLL_MS = 30_000;

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

/** Parse "Repository: org/repo" from task description */
export function parseRepo(description: string): string | null {
  const match = description.match(/^Repository:\s*(\S+)/m);
  return match ? match[1] : null;
}

/** Reset an existing repo to a clean state on its default branch (remote as source of truth). */
function resetExistingRepo(dir: string): void {
  const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: dir, stdio: 'pipe' });

  // Detect the default branch from the remote HEAD
  const remoteInfo = run('git', ['remote', 'show', 'origin']).toString();
  const headMatch = remoteInfo.match(/HEAD branch:\s*(\S+)/);
  const defaultBranch = headMatch ? headMatch[1] : 'main';

  // Abort any in-progress operations
  try {
    run('git', ['merge', '--abort']);
  } catch {
    /* no merge in progress */
  }
  try {
    run('git', ['rebase', '--abort']);
  } catch {
    /* no rebase in progress */
  }

  // Discard all local state and switch to the default branch
  run('git', ['checkout', '--force', defaultBranch]);
  run('git', ['clean', '-fd']);
  run('git', ['fetch', 'origin', defaultBranch]);
  run('git', ['reset', '--hard', `origin/${defaultBranch}`]);
}

/** Clone a repo (or reset if already cloned) and return the directory path. */
export function cloneRepo(repo: string, cwd: string): Promise<string> {
  const repoName = repo.split('/').pop()!;
  const dir = `${cwd}/${repoName}`;

  // If already cloned, reset to a fresh state instead of re-cloning
  if (existsSync(`${dir}/.git`)) {
    resetExistingRepo(dir);
    return Promise.resolve(dir);
  }

  return new Promise((resolve, reject) => {
    execFile('gh', ['repo', 'clone', repo, dir, '--', '--depth', '1'], (err) => {
      if (err) reject(new Error(`Failed to clone ${repo}: ${err.message}`));
      else resolve(dir);
    });
  });
}

export class TaskOwnershipLostError extends Error {
  constructor(taskId: string) {
    super(`Task ${taskId} is no longer assigned to this agent`);
    this.name = 'TaskOwnershipLostError';
  }
}

export interface SessionLogOptions {
  logging: boolean;
}

export interface ClaudeResult {
  output: string;
  resultEvent: Record<string, unknown> | null;
}

/**
 * Check if the agent still owns the task. Returns false if task is
 * no longer assigned to us.
 */
export async function checkOwnership(taskId: string): Promise<boolean> {
  try {
    const task = await api.getTask(taskId);
    const cred = getActiveCredential();
    return task.assigneeId === cred?.agentId;
  } catch {
    // Network error — assume still owned to avoid false aborts
    return true;
  }
}

/**
 * Start polling task ownership. Returns a cleanup function.
 * Calls onLost() if ownership is lost, which should kill the running process.
 */
export function startOwnershipPolling(taskId: string, onLost: () => void): () => void {
  const timer = setInterval(async () => {
    const owned = await checkOwnership(taskId);
    if (!owned) {
      clearInterval(timer);
      onLost();
    }
  }, OWNERSHIP_POLL_MS);

  return () => clearInterval(timer);
}

/**
 * Run Claude via spawn with stream-json output, accumulating full output
 * and streaming session logs to Nova. Supports external abort via signal.
 */
export function runClaudeStreaming(
  prompt: string,
  taskId: string,
  opts: { cwd?: string; logging: boolean; signal?: AbortSignal },
): Promise<ClaudeResult> {
  return new Promise((resolve, reject) => {
    const args = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      '30',
      '--permission-mode',
      'bypassPermissions',
      '--allowedTools',
      'Bash,Read,Edit,Write,Glob,Grep',
      '--no-session-persistence',
    ];

    const proc = spawn('claude', args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Wire up abort signal to kill the process
    if (opts.signal) {
      if (opts.signal.aborted) {
        proc.kill('SIGTERM');
        reject(new TaskOwnershipLostError(taskId));
        return;
      }
      const onAbort = () => proc.kill('SIGTERM');
      opts.signal.addEventListener('abort', onAbort, { once: true });
      proc.on('close', () => opts.signal!.removeEventListener('abort', onAbort));
    }

    let fullOutput = '';
    let resultEvent: Record<string, unknown> | null = null;
    const lineBuffer: Array<{ t: number; text: string }> = [];
    let lastFlush = Date.now();
    const FLUSH_LINES = 20;
    const FLUSH_INTERVAL_MS = 5000;

    function flushLines(done = false) {
      if (!opts.logging) return;
      if (lineBuffer.length === 0 && !done) return;
      const toSend = lineBuffer.splice(0);
      api.logSession(taskId, toSend, done).catch(() => {});
    }

    const rl = createInterface({ input: proc.stdout! });

    rl.on('line', (line) => {
      try {
        const event = JSON.parse(line);

        // Write trimmed text followed by a single newline
        const writeLn = (text: string) => {
          const trimmed = text.trim();
          if (trimmed) process.stdout.write(trimmed + '\n');
        };

        // Extract text content from stream events
        if (event.type === 'assistant') {
          if (event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'text') {
                fullOutput += block.text;
                lineBuffer.push({ t: Date.now(), text: block.text });
                writeLn(block.text);
              } else if (block.type === 'tool_use') {
                const HIDDEN_TOOLS = ['TodoWrite', 'TodoRead'];
                if (!HIDDEN_TOOLS.includes(block.name)) {
                  writeLn(`[tool] ${block.name}`);
                }
              }
            }
          }
        } else if (event.type === 'content_block_delta' && event.delta?.text) {
          fullOutput += event.delta.text;
          lineBuffer.push({ t: Date.now(), text: event.delta.text });
          writeLn(event.delta.text);
        } else if (event.type === 'result') {
          // Capture the entire result event as-is for server-side extraction
          resultEvent = event;
          if (typeof event.result === 'string' && !fullOutput) {
            fullOutput = event.result;
          }
          process.stdout.write('\n');
        }

        // Periodic flush
        const now = Date.now();
        if (lineBuffer.length >= FLUSH_LINES || now - lastFlush >= FLUSH_INTERVAL_MS) {
          flushLines();
          lastFlush = now;
        }
      } catch {
        // Not JSON or unknown format — skip
      }
    });

    let stderrOutput = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    proc.on('close', (code, signal) => {
      flushLines(true);
      if (opts.signal?.aborted) {
        reject(new TaskOwnershipLostError(taskId));
      } else if (code === 0) {
        resolve({ output: fullOutput, resultEvent });
      } else {
        reject(new Error(stderrOutput || `claude exited with code ${code} (signal: ${signal})`));
      }
    });

    proc.on('error', (err) => {
      flushLines(true);
      reject(err);
    });
  });
}

export async function processTask(
  task: Task,
  provider: string,
  opts: SessionLogOptions = { logging: true },
): Promise<void> {
  const label = `[${task.id}]`;

  try {
    await api.claimTask(task.id);
    log(`Claiming: "${task.title}" (${task.id})`);

    const startRes = await api.reportStatus('start', `[${provider}] ${task.title}`, task.id);
    if (startRes.owned === false) {
      log(`${label} Lost ownership before start, aborting`);
      return;
    }

    const prompt = `Task: ${task.title}\n\n${task.description}`;

    if (provider === 'claude') {
      // Streaming path for Claude
      let cwd: string | undefined;

      // Check if task description contains a repo to clone
      const repo = parseRepo(task.description);
      if (repo) {
        const tmpDir = `/tmp/novadev-${task.id}`;
        try {
          const { mkdirSync } = await import('node:fs');
          mkdirSync(tmpDir, { recursive: true });
          const repoName = repo.split('/').pop()!;
          const alreadyCloned = existsSync(`${tmpDir}/${repoName}/.git`);
          cwd = await cloneRepo(repo, tmpDir);
          log(`${label} ${alreadyCloned ? 'Reset' : 'Cloned'} ${repo} → ${cwd}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log(`${label} Clone failed: ${msg}`);
          // Continue without repo — Claude can still work
        }
      }

      log(`${label} Running: claude (streaming)`);
      const startTime = Date.now();

      // Set up ownership polling with abort controller
      const ac = new AbortController();
      const stopPolling = startOwnershipPolling(task.id, () => {
        log(`${label} Ownership lost — aborting Claude process`);
        ac.abort();
      });

      let result: ClaudeResult;
      try {
        result = await runClaudeStreaming(prompt, task.id, {
          cwd,
          logging: opts.logging,
          signal: ac.signal,
        });
      } finally {
        stopPolling();
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);

      // Verify ownership before reporting done
      const summary = result.output.slice(0, 4096);
      const doneRes = await api.reportStatus('done', `[${provider}] ${summary}`, task.id);
      if (doneRes.owned === false) {
        log(`${label} Lost ownership — not reporting done (${elapsed}s of work)`);
        return;
      }

      // Report raw result event for server-side extraction
      if (result.resultEvent) {
        api.reportUsage(task.id, result.resultEvent).catch(() => {});
        const u = result.resultEvent.usage as Record<string, number> | undefined;
        const cost =
          typeof result.resultEvent.total_cost_usd === 'number'
            ? ` $${result.resultEvent.total_cost_usd.toFixed(4)}`
            : '';
        const turns =
          typeof result.resultEvent.num_turns === 'number'
            ? ` ${result.resultEvent.num_turns}turns`
            : '';
        log(`${label} Usage: ${u?.input_tokens ?? 0}in/${u?.output_tokens ?? 0}out${turns}${cost}`);
      }

      log(`${label} Done (${elapsed}s)`);
    } else {
      // Legacy execFile path for other providers
      const { command, buildArgs } = PROVIDERS[provider];
      log(`${label} Running: ${command} ${buildArgs('...').join(' ')}`);

      const startTime = Date.now();
      const output = await runProvider(provider, prompt);
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      const doneRes = await api.reportStatus('done', `[${provider}] ${output}`, task.id);
      if (doneRes.owned === false) {
        log(`${label} Lost ownership — not reporting done (${elapsed}s of work)`);
        return;
      }
      log(`${label} Done (${elapsed}s)`);
    }
  } catch (err) {
    if (err instanceof TaskOwnershipLostError) {
      log(`${label} Aborted: ${err.message}`);
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    await api.unclaimTask(task.id, message).catch(() => {});
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
  .option('--no-logging', 'Disable session log streaming')
  .action(
    async (opts: { interval: string; concurrency: string; provider: string; logging: boolean }) => {
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
        `Gateway started. Provider: ${provider}. Polling every ${opts.interval}s. Concurrency: ${concurrency}. Logging: ${opts.logging}. Ctrl+C to stop.`,
      );

      let shutdownRequested = false;
      let activeTasks = 0;
      const activeTaskIds = new Set<string>();

      process.on('SIGINT', async () => {
        if (shutdownRequested) process.exit(1);
        shutdownRequested = true;
        log(`Shutting down... unclaiming ${activeTaskIds.size} active task(s)`);
        for (const id of activeTaskIds) {
          await api.unclaimTask(id, 'Agent gateway shut down').catch(() => {});
        }
      });

      while (!shutdownRequested) {
        // Heartbeat — fire-and-forget
        api.heartbeat().catch((err) => {
          log(`Heartbeat failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
        });

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
              activeTaskIds.add(task.id);
              processTask(task, provider, { logging: opts.logging }).finally(() => {
                activeTasks--;
                activeTaskIds.delete(task.id);
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
    },
  );
