import type { AgentAccount, AgentId, AgentSignIn } from '@grimoire/contract';
import type { Emit } from '../events';
import type { AgentAdapter, SignInRun } from './adapter';
import type { ChatTable } from './chat-table';

/** A sign-in under way, waiting for you in the browser. */
interface SigningIn {
  email: string;
  url: string | null;
  run: SignInRun;
}

/** An email: something, an @, and a domain, without spaces. */
const EMAIL = /^[^\s@]+@[^\s@]+$/;

/**
 * Who each agent is signed in as, and the sign-ins to another account
 * under way, one per agent. Every window hears of each change.
 */
export class Accounts {
  /** Who each agent was last read to be signed in as. */
  private readonly accounts = new Map<AgentId, AgentAccount | null>();
  private readonly signIns = new Map<AgentId, SigningIn>();

  constructor(
    private readonly emit: Emit,
    private readonly table: ChatTable,
    /** The agent was just signed in to another account. */
    private readonly signedIn: (adapter: AgentAdapter) => void,
  ) {}

  /** Who the agent is signed in as, read now, and any sign-in under way. */
  account(agent: AgentId): Promise<AgentSignIn> {
    return this.signInState(agent, true);
  }

  /** Signs the agent in to another account, in the browser; a sign-in already under way is cancelled. */
  async signIn(agent: AgentId, email: string): Promise<AgentSignIn> {
    const adapter = this.table.adapter(agent);
    if (!adapter.signIn) throw new Error(`${adapter.info.name} can't switch accounts`);
    const to = email.trim();
    if (!EMAIL.test(to)) throw new Error('Give the email of the account to sign in to');
    this.signIns.get(agent)?.run.cancel();
    const signingIn: SigningIn = {
      email: to,
      url: null,
      run: adapter.signIn(to, (url) => {
        if (this.signIns.get(agent) !== signingIn) return;
        signingIn.url = url;
        void this.announce(agent, false);
      }),
    };
    this.signIns.set(agent, signingIn);
    void this.announce(agent, false);
    try {
      await signingIn.run.done;
    } catch (error) {
      if (this.signIns.get(agent) === signingIn) {
        this.signIns.delete(agent);
        void this.announce(agent, false);
      }
      throw error;
    }
    if (this.signIns.get(agent) === signingIn) this.signIns.delete(agent);
    this.signedIn(adapter);
    return this.announce(agent, true);
  }

  /** Passes on the code the sign-in page shows, when it doesn't return to the agent by itself. */
  signInCode(agent: AgentId, code: string): void {
    const signingIn = this.signIns.get(agent);
    if (!signingIn) throw new Error('No sign-in is under way');
    if (!code.trim()) throw new Error('Paste the code the sign-in page shows');
    signingIn.run.code(code);
  }

  /** Stops a sign-in under way; the agent stays signed in as before. */
  cancelSignIn(agent: AgentId): void {
    this.signIns.get(agent)?.run.cancel();
  }

  cancelAll(): void {
    for (const signingIn of this.signIns.values()) signingIn.run.cancel();
  }

  signingIn(): boolean {
    return this.signIns.size > 0;
  }

  /** Forgets who the agents were signed in as; they're read again when next asked. */
  forget(): void {
    this.accounts.clear();
  }

  /** Every window hears who each agent is signed in as now, read again. */
  async announceAll(): Promise<void> {
    await Promise.all(
      [...this.table.adapters.values()].map(async (adapter) => {
        if (!adapter.account) return;
        await this.announce(adapter.info.id, true);
      }),
    );
  }

  /** Who the agent is signed in as, read again when `fresh`, and any sign-in under way. */
  private async signInState(agent: AgentId, fresh: boolean): Promise<AgentSignIn> {
    const adapter = this.table.adapter(agent);
    if (fresh || !this.accounts.has(agent))
      this.accounts.set(agent, (await adapter.account?.()) ?? null);
    return this.knownSignIn(agent);
  }

  /** Who the agent was last read to be signed in as, and any sign-in under way. */
  private knownSignIn(agent: AgentId): AgentSignIn {
    const signingIn = this.signIns.get(agent);
    return {
      agent,
      account: this.accounts.get(agent) ?? null,
      pending: signingIn ? { email: signingIn.email, url: signingIn.url } : null,
    };
  }

  /** Every window hears of a sign-in that began, changed or ended. */
  private async announce(agent: AgentId, fresh: boolean): Promise<AgentSignIn> {
    const state = await this.signInState(agent, fresh).catch(() => this.knownSignIn(agent));
    this.emit('agents.account', state);
    return state;
  }
}
