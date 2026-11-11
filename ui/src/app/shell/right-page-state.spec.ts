import { TestBed } from '@angular/core/testing';
import { type CommandSearch, RightPageState } from './right-page-state';

const search: CommandSearch = { chatId: 'c1', agent: 'claude-code', query: '', use: () => {} };

describe('RightPageState', () => {
  it('turns to one thing at a time, and back to its own pages', () => {
    const state = TestBed.inject(RightPageState);
    expect(state.turned()).toBe(false);
    state.openApprovals('a1');
    expect(state.firstApproval()).toBe('a1');
    state.openCommandPalette('fix');
    expect([state.approvals(), state.commandPalette()]).toEqual([false, 'fix']);
    state.openCommands(search);
    expect([state.commandPalette(), state.commands()]).toEqual([null, search]);
    state.openPageTab('settings');
    expect([state.commands(), state.pageTab()]).toEqual([null, 'settings']);
    expect(state.turned()).toBe(true);

    state.showPage('plan');
    expect(state.page()).toBe('plan');
    expect(state.turned()).toBe(false);
  });

  it('stays on a page tab’s page while its guard says so, until the guard is taken away', () => {
    const state = TestBed.inject(RightPageState);
    state.openPageTab('memories');
    let keep = true;
    const unguard = state.guardLeaving(() => !keep);

    state.closePageTab();
    state.openApprovals();
    state.openCommandPalette();
    state.openCommands(search);
    state.showPage('plan');
    state.openPageTab('settings');
    expect(state.pageTab()).toBe('memories');
    expect(state.approvals()).toBe(false);
    // Turning to the page it shows isn't leaving it.
    state.openPageTab('memories');
    expect(state.pageTab()).toBe('memories');

    keep = false;
    state.openPageTab('settings');
    expect(state.pageTab()).toBe('settings');
    keep = true;
    unguard();
    state.closePageTab();
    expect(state.pageTab()).toBeNull();
  });

  it('keeps a newer guard when an older one is taken away', () => {
    const state = TestBed.inject(RightPageState);
    state.openPageTab('memories');
    const unguardOld = state.guardLeaving(() => true);
    state.guardLeaving(() => false);
    unguardOld();
    state.closePageTab();
    expect(state.pageTab()).toBe('memories');
  });
});
