import { spawn } from 'node:child_process';
import { redactCloneUrl } from './redact-clone-url';

/** stdout kept in memory for one call; `onLine` streams larger outputs. */
const MAX_STDOUT_BYTES = 64 * 1024 * 1024;

/** Last bytes of stderr quoted in an error. */
const STDERR_TAIL_BYTES = 8 * 1024;

/** A git call that failed, timed out or could not start. */
export class GitCommandError extends Error {
  constructor(
    message: string,
    /** git's exit code, or `null` when it was killed or never started. */
    readonly exitCode: number | null,
    /** `true` when the call was killed at its timeout. */
    readonly timedOut = false,
  ) {
    super(message);
    this.name = 'GitCommandError';
  }
}

export interface RunGitOptions {
  /** Names the call in errors (`git <label> failed …`). */
  label: string;
  timeoutMs: number;
  /** Authenticated URL redacted from every error. */
  cloneUrl?: string;
  /**
   * Polled every `pollIntervalMs` while git runs; once it resolves `true`,
   * the call is killed and resolves with `stopped: true` instead of failing.
   */
  shouldStop?: () => Promise<boolean>;
  pollIntervalMs?: number;
  /** Receives stdout line by line instead of keeping it in memory. */
  onLine?: (line: string) => void;
}

export interface RunGitResult {
  stdout: string;
  /** `true` when `shouldStop` asked for the call to be killed. */
  stopped: boolean;
}

/**
 * Runs `git <args>` in its own process group.
 *
 * A fetch is not one process: git starts `index-pack`, a remote helper or
 * `upload-pack`, which write the incoming pack themselves. Killing only `git`
 * would leave them writing to disk, so every kill (timeout, `shouldStop`)
 * sends SIGKILL to the whole group. The call settles once every process that
 * held its stdout/stderr is gone, so nothing writes to the repository after.
 */
export function runGit(
  args: string[],
  options: RunGitOptions,
): Promise<RunGitResult> {
  const redact = (s: string): string =>
    redactCloneUrl(s, options.cloneUrl ?? '');

  return new Promise<RunGitResult>((resolve, reject) => {
    const child = spawn('git', args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });

    let settled = false;
    let stopped = false;
    let timedOut = false;
    let overflowed = false;
    let polling = false;
    let stdout = '';
    let stdoutBytes = 0;
    let pendingLine = '';
    let stderrTail = '';

    const killGroup = (): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // The group is already gone.
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, options.timeoutMs);

    const poller = options.shouldStop
      ? setInterval(() => {
          if (polling || stopped || settled) return;
          polling = true;
          options
            .shouldStop()
            .then((stop) => {
              if (stop && !settled) {
                stopped = true;
                killGroup();
              }
            })
            .catch(() => undefined)
            .finally(() => {
              polling = false;
            });
        }, options.pollIntervalMs ?? 500)
      : undefined;

    const finish = (): void => {
      settled = true;
      clearTimeout(timer);
      if (poller) clearInterval(poller);
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (options.onLine) {
        const lines = (pendingLine + chunk).split('\n');
        pendingLine = lines.pop() ?? '';
        for (const line of lines) options.onLine(line);
        return;
      }
      stdoutBytes += Buffer.byteLength(chunk);
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        overflowed = true;
        killGroup();
        return;
      }
      stdout += chunk;
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
    });

    child.once('error', (err) => {
      if (settled) return;
      finish();
      killGroup();
      reject(
        new GitCommandError(
          redact(`git ${options.label} could not run: ${err.message}`),
          null,
        ),
      );
    });

    child.once('close', (code, signal) => {
      if (settled) return;
      finish();
      if (options.onLine && pendingLine) options.onLine(pendingLine);
      if (stopped) {
        resolve({ stdout, stopped: true });
        return;
      }
      if (timedOut) {
        reject(
          new GitCommandError(
            redact(
              `git ${options.label} timed out after ${options.timeoutMs} ms`,
            ),
            null,
            true,
          ),
        );
        return;
      }
      if (overflowed) {
        reject(
          new GitCommandError(
            `git ${options.label} printed more than ${MAX_STDOUT_BYTES} bytes`,
            null,
          ),
        );
        return;
      }
      if (code === 0) {
        resolve({ stdout, stopped: false });
        return;
      }
      const detail = stderrTail.trim();
      reject(
        new GitCommandError(
          redact(
            `git ${options.label} failed (${code ?? signal})` +
              (detail ? `: ${detail}` : ''),
          ),
          code,
        ),
      );
    });
  });
}
