import type { AgentSignIn, GrimoireSettings } from '@grimoire/contract';
import { DEFAULT_SETTINGS } from '@grimoire/contract';
import { fakeBridge, render } from '@ui/testing/app-testing';

describe('accounts', () => {
  it('switches the account Claude Code signs in as in Settings, for every chat', async () => {
    const { bridge, answers, calls, emit } = fakeBridge();
    answers['agents.list'] = () => [
      { id: 'claude-code', name: 'Claude Code', capabilities: ['sign-in'] },
    ];
    let kept: GrimoireSettings = { ...DEFAULT_SETTINGS, accounts: ['mum@example.com'] };
    answers['settings.get'] = () => kept;
    answers['settings.set'] = (change: Partial<GrimoireSettings>) =>
      (kept = { ...kept, ...change });
    const me = { email: 'me@example.com', plan: 'pro', expiresAt: null };
    answers['agents.account'] = (): AgentSignIn => ({
      agent: 'claude-code',
      account: me,
      pending: null,
    });
    let finish!: (state: AgentSignIn) => void;
    let fail!: (error: Error) => void;
    answers['agents.signIn'] = () =>
      new Promise<AgentSignIn>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
    const { fixture, el, texts } = await render(bridge);
    [...el.querySelectorAll<HTMLButtonElement>('gr-page-tabs .page-tab')]
      .find((tab) => tab.textContent!.trim() === 'Colophon')!
      .click();
    await fixture.whenStable();
    const row = '[aria-labelledby="gr-settings-account"]';
    const word = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>(`${row} .word`)].find(
        (button) => button.textContent!.trim() === text,
      )!;
    const link = (text: string) =>
      [...el.querySelectorAll<HTMLButtonElement>('gr-settings-page .gr-link')].find(
        (button) => button.textContent!.trim() === text,
      )!;
    const signIns = () => calls.filter((c) => c.command === 'agents.signIn').map((c) => c.request);

    expect(texts('section[aria-labelledby="gr-settings-general"] .label').at(-1)).toBe(
      'Claude Code signs in as',
    );
    expect(texts(`${row} .word`)).toEqual(['mum@example.com', 'me@example.com']);
    expect(texts(`${row} .word[aria-checked="true"]`)).toEqual(['me@example.com']);
    expect(texts('gr-settings-page .note').at(-1)).toMatch(/^Pro\. Every chapter uses it/);

    // Signing in to another keeps the one signed in as, to switch back to.
    word('mum@example.com').click();
    await fixture.whenStable();
    expect(kept.accounts).toEqual(['mum@example.com', 'me@example.com']);
    expect(signIns()).toEqual([{ agent: 'claude-code', email: 'mum@example.com' }]);
    emit('agents.account', {
      agent: 'claude-code',
      account: me,
      pending: { email: 'mum@example.com', url: 'https://example.com/sign-in' },
    });
    await fixture.whenStable();
    expect(texts('gr-settings-page [role="status"]')[0]).toMatch(
      /^Waiting for you to sign in as mum@example\.com in the browser\. Copy the sign-in link Cancel$/,
    );
    expect(word('me@example.com').disabled).toBe(true);
    const code = el.querySelector<HTMLInputElement>('#gr-settings-sign-in-code')!;
    code.value = 'abc#123';
    code.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(calls.find((c) => c.command === 'agents.signInCode')!.request).toEqual({
      agent: 'claude-code',
      code: 'abc#123',
    });

    const mum: AgentSignIn = {
      agent: 'claude-code',
      account: { email: 'mum@example.com', plan: 'max', expiresAt: null },
      pending: null,
    };
    emit('agents.account', mum);
    finish(mum);
    await fixture.whenStable();
    expect(texts(`${row} .word[aria-checked="true"]`)).toEqual(['mum@example.com']);
    expect(texts('gr-settings-page .note').at(-1)).toMatch(/^Max\. /);

    // Forgetting an account takes it off the list only.
    el.querySelector<HTMLButtonElement>(`${row} [aria-label="Forget me@example.com"]`)!.click();
    await fixture.whenStable();
    expect(kept.accounts).toEqual(['mum@example.com']);

    // Another account is signed in to once its email is written; a failure says why.
    link('Another account').click();
    await fixture.whenStable();
    const field = el.querySelector<HTMLInputElement>('gr-settings-page .account-field')!;
    expect(document.activeElement).toBe(field);
    field.value = 'dad@example.com';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(signIns().at(-1)).toEqual({ agent: 'claude-code', email: 'dad@example.com' });
    expect(kept.accounts).toEqual(['mum@example.com', 'dad@example.com']);
    fail(new Error('Login failed: the account is on hold'));
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(texts('gr-settings-page [role="alert"]')).toEqual([
      'Login failed: the account is on hold',
    ]);
  });
});
