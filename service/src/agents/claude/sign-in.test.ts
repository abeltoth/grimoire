import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { claudeExecutable, failureIn, signIn, toAccount, type SignInProcess } from './sign-in';

/** A sign-in process the test drives: what it writes, what it's sent, and how it ends. */
class FakeProcess extends EventEmitter implements SignInProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly written: string[] = [];
  killed = false;

  constructor() {
    super();
    this.stdin.on('data', (chunk: Buffer) => this.written.push(chunk.toString()));
  }

  kill(): boolean {
    this.killed = true;
    this.emit('exit', null);
    return true;
  }
}

const PAGE = 'https://claude.com/cai/oauth/authorize?code=true&login_hint=mum%40example.com';

/** Lets the streams pass on what was written. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('Claude Code sign-in', () => {
  it('finds the Claude Code binary the Agent SDK runs', () => {
    expect(existsSync(claudeExecutable())).toBe(true);
  });

  it('reads who Claude Code is signed in as', () => {
    expect(
      toAccount({
        loggedIn: true,
        email: 'me@example.com',
        subscriptionType: 'pro',
        loginExpiresAt: '2026-12-06T17:09:35.606Z',
      }),
    ).toEqual({
      email: 'me@example.com',
      plan: 'pro',
      expiresAt: Date.parse('2026-12-06T17:09:35.606Z'),
    });
    expect(toAccount({ loggedIn: true, email: 'me@example.com' })).toEqual({
      email: 'me@example.com',
      plan: null,
      expiresAt: null,
    });
    expect(toAccount({ loggedIn: false })).toBeNull();
  });

  it('says why a sign-in failed, leaving out its own steps', () => {
    expect(
      failureIn(
        `Opening browser to sign in…\nIf the browser didn't open, visit: ${PAGE}\nPaste code here if prompted > \x1b[31mOAuth error: invalid code\x1b[0m\n`,
      ),
    ).toBe('OAuth error: invalid code');
    expect(failureIn('Opening browser to sign in…\n')).toBeUndefined();
  });

  it('passes on the sign-in page, then any code, and settles once signed in', async () => {
    const child = new FakeProcess();
    const pages: string[] = [];
    const run = signIn(
      'mum@example.com',
      (url) => pages.push(url),
      () => child,
    );

    child.stdout.write('Opening browser to sign in…\n');
    child.stdout.write(
      `If the browser didn't open, visit: ${PAGE}\nPaste code here if prompted > `,
    );
    await settle();
    expect(pages).toEqual([PAGE]);

    run.code(' abc#123 ');
    await settle();
    expect(child.written).toEqual(['abc#123\n']);

    child.stdout.write('Login successful.\n');
    child.emit('exit', 0);
    await expect(run.done).resolves.toBeUndefined();
    expect(pages).toHaveLength(1);
  });

  it('rejects, saying why, when the sign-in fails', async () => {
    const child = new FakeProcess();
    const run = signIn(
      'mum@example.com',
      () => {},
      () => child,
    );
    child.stderr.write('Login failed: the account is on hold\n');
    await settle();
    child.emit('exit', 1);
    await expect(run.done).rejects.toThrow('Login failed: the account is on hold');
  });

  it('stops the sign-in when cancelled', async () => {
    const child = new FakeProcess();
    const run = signIn(
      'mum@example.com',
      () => {},
      () => child,
    );
    run.cancel();
    expect(child.killed).toBe(true);
    await expect(run.done).rejects.toThrow('cancelled');
  });

  it("rejects when Claude Code can't be started", async () => {
    const child = new FakeProcess();
    const run = signIn(
      'mum@example.com',
      () => {},
      () => child,
    );
    child.emit('error', new Error('ENOENT'));
    await expect(run.done).rejects.toThrow("Couldn't start Claude Code's sign-in: ENOENT");
  });
});
