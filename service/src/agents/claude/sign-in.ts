import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import type { AgentAccount } from '@grimoire/contract';
import type { SignInRun } from '../adapter';

/**
 * Claude Code's own binary, the one the Agent SDK runs chats on: from the
 * SDK's package for this platform, found the way the SDK finds it.
 */
export function claudeExecutable(platform = process.platform, arch = process.arch): string {
  const sdk = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk');
  const binary = `claude${platform === 'win32' ? '.exe' : ''}`;
  return createRequire(sdk).resolve(`@anthropic-ai/claude-agent-sdk-${platform}-${arch}/${binary}`);
}

/** What `claude auth status --json` says, as far as Grimoire reads it. */
interface AuthStatus {
  loggedIn?: boolean;
  email?: string;
  subscriptionType?: string | null;
  loginExpiresAt?: string | null;
}

/** The account `claude auth status --json` names; null while signed out. */
export function toAccount(status: AuthStatus): AgentAccount | null {
  if (!status.loggedIn) return null;
  const expiresAt = status.loginExpiresAt ? Date.parse(status.loginExpiresAt) : NaN;
  return {
    email: status.email ?? '',
    plan: status.subscriptionType || null,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
  };
}

/** Who Claude Code is signed in as, from `claude auth status`. */
export function readAccount(binary = claudeExecutable()): Promise<AgentAccount | null> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      ['auth', 'status', '--json'],
      { timeout: 20_000, windowsHide: true },
      (error, stdout) => {
        // Signed out, it still writes its status, though it may exit with an error.
        try {
          resolve(toAccount(JSON.parse(stdout) as AuthStatus));
        } catch {
          reject(error ?? new Error("Claude Code didn't say who it's signed in as"));
        }
      },
    );
  });
}

/** What a sign-in needs of a process: its output, its input, and a way to stop it. */
export interface SignInProcess {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  stdin: NodeJS.WritableStream;
  kill(): boolean;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
/** The page Claude Code says to visit when the browser didn't open by itself. */
const PAGE = /visit:\s*(https:\/\/\S+)/;
/** Lines that are the sign-in's own steps, not a reason it failed. */
const STEPS = /^(Opening browser|If the browser didn't open|Login successful)/;
/** The prompt for a code, which what comes next is written after, on the same line. */
const CODE_PROMPT = /Paste code here if prompted\s*>/g;

/** The last thing Claude Code said that isn't one of the sign-in's steps: why it failed. */
export function failureIn(output: string): string | undefined {
  return output
    .replace(ANSI, '')
    .replace(CODE_PROMPT, '\n')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !STEPS.test(line))
    .at(-1);
}

/**
 * Signs Claude Code in to the claude.ai account with this email, the way
 * `/login` does: it opens the browser on the sign-in page, the email
 * filled in, and saves the new sign-in in Claude Code's own place
 * (Grimoire never sees it). `page` gets the page's address, to
 * open by hand; when the page shows a code instead of returning by itself,
 * code() passes it on.
 */
export function signIn(
  email: string,
  page: (url: string) => void,
  start: () => SignInProcess = () =>
    spawn(claudeExecutable(), ['auth', 'login', '--claudeai', '--email', email], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }),
): SignInRun {
  const child = start();
  let output = '';
  let found = false;
  let cancelled = false;
  const read = (chunk: Buffer | string) => {
    output += chunk.toString();
    const url = !found && PAGE.exec(output.replace(ANSI, ''))?.[1];
    if (url) {
      found = true;
      page(url);
    }
  };
  child.stdout.on('data', read);
  child.stderr.on('data', read);
  // A code passed on after the process ended can't be written; that mustn't stop the service.
  child.stdin.on('error', () => {});
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', (error) =>
      reject(new Error(`Couldn't start Claude Code's sign-in: ${error.message}`)),
    );
    child.on('exit', (code) => {
      if (cancelled) reject(new Error('The sign-in was cancelled'));
      else if (code === 0) resolve();
      else
        reject(new Error(failureIn(output) ?? `Claude Code's sign-in stopped (exit code ${code})`));
    });
  });
  return {
    done,
    code: (code) => void child.stdin.write(`${code.trim()}\n`),
    cancel: () => {
      cancelled = true;
      child.kill();
    },
  };
}
