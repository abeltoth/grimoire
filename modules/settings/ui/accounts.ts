import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import type { AgentId, AgentSignIn } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';
import { Settings } from '@ui/app/core/settings';

/** An email: something, an @, and a domain, without spaces. */
const EMAIL = /^[^\s@]+@[^\s@]+$/;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The emails given, each once whatever its case, in the order first given. */
function each(emails: readonly string[]): string[] {
  return emails.filter((email, i) => emails.findIndex((other) => same(other, email)) === i);
}

/**
 * The accounts Settings switches the agent's sign-in between: the
 * emails kept in the settings, and the one it's signed in as. Signing in
 * to another goes through the agent, in the browser, for every chat; the
 * service says who it's signed in as, and every window follows.
 */
@Injectable()
export class Accounts {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly settings = inject(Settings);
  private readonly chats = inject(Chats);
  /** Counts the sign-ins asked for here, so only the latest one's failure shows. */
  private attempts = 0;

  /** The agent whose sign-in is switched: the first that can switch. */
  readonly agent = computed(
    () => this.chats.agents().find((agent) => agent.capabilities.includes('sign-in')) ?? null,
  );
  readonly state = signal<AgentSignIn | null>(null);
  /** Why the last sign-in didn't happen. */
  readonly failed = signal<string | null>(null);

  /** The email it's signed in as; null while signed out or before it's known. */
  readonly current = computed(() => this.state()?.account?.email || null);
  /** The emails to pick from: those kept, then the one signed in as when it isn't kept. */
  readonly emails = computed(() =>
    each([...this.settings.all().accounts, ...(this.current() ? [this.current()!] : [])]),
  );

  constructor() {
    const off = this.bridge.on('agents.account', (state) => {
      if (state.agent === this.agent()?.id) this.state.set(state);
    });
    inject(DestroyRef).onDestroy(off);
    effect(() => {
      const agent = this.agent();
      if (agent) untracked(() => void this.load(agent.id));
    });
  }

  isCurrent(email: string): boolean {
    const current = this.current();
    return !!current && same(current, email);
  }

  /**
   * Signs in to the account with this email, keeping it, and the one signed
   * in as now, to switch back to. A cancelled sign-in says nothing.
   */
  async signIn(email: string): Promise<void> {
    const agent = this.agent();
    const to = email.trim();
    if (!agent) return;
    if (!EMAIL.test(to)) {
      this.failed.set('That isn’t an email');
      return;
    }
    this.failed.set(null);
    const attempt = ++this.attempts;
    await this.keep(to);
    try {
      const state = await this.bridge.invoke('agents.signIn', { agent: agent.id, email: to });
      if (state) this.state.set(state);
      if (state?.account?.email) await this.keep(state.account.email);
    } catch (error) {
      if (attempt === this.attempts)
        this.failed.set(error instanceof Error ? error.message : String(error));
    }
  }

  /** Stops the sign-in under way; it stays signed in as before. */
  async cancel(): Promise<void> {
    const agent = this.agent();
    if (!agent) return;
    this.attempts++;
    await this.bridge.invoke('agents.cancelSignIn', { agent: agent.id }).catch(() => {});
  }

  /** Passes on the code the sign-in page shows. */
  async code(code: string): Promise<void> {
    const agent = this.agent();
    if (!agent || !code.trim()) return;
    try {
      await this.bridge.invoke('agents.signInCode', { agent: agent.id, code });
    } catch (error) {
      this.failed.set(error instanceof Error ? error.message : String(error));
    }
  }

  /** Takes an email off the list; the account itself stays as it is. */
  forget(email: string): void {
    void this.settings.set({
      accounts: this.settings.all().accounts.filter((kept) => !same(kept, email)),
    });
  }

  /** Keeps the email, and the one signed in as now, on the list. */
  private async keep(email: string): Promise<void> {
    const kept = this.settings.all().accounts;
    const accounts = each([...kept, ...(this.current() ? [this.current()!] : []), email]);
    if (accounts.length !== kept.length) await this.settings.set({ accounts });
  }

  private async load(agent: AgentId): Promise<void> {
    try {
      const state = await this.bridge.invoke('agents.account', { agent });
      if (state) this.state.set(state);
    } catch (error) {
      this.failed.set(error instanceof Error ? error.message : String(error));
    }
  }
}
