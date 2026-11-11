import { TestBed } from '@angular/core/testing';
import type { CommandRequest, TerminalInfo } from '@grimoire/contract';
import { useFakeBridge } from '@ui/testing/app-testing';
import { Terminals } from './terminals';

const shell = (id: string, cwd = 'C:/Users/me/git/grimoire'): TerminalInfo => ({
  id,
  cwd,
  shell: 'pwsh',
  openedAt: 0,
});

describe('Terminals', () => {
  function withTerminals(running: TerminalInfo[]) {
    const fake = useFakeBridge();
    let next = 0;
    fake.answers['terminal.list'] = () => running;
    fake.answers['terminal.open'] = ({ cwd }: CommandRequest<'terminal.open'>) =>
      shell(`new-${++next}`, cwd);
    return { ...fake, terminals: TestBed.inject(Terminals) };
  }

  it('reads the running shells and shows the newest', async () => {
    const { terminals, calls } = withTerminals([shell('a'), shell('b')]);
    await terminals.load();
    expect(terminals.read()).toBe(true);
    expect(terminals.shown()?.id).toBe('b');
    expect(calls.some((c) => c.command === 'terminal.open')).toBe(false);
  });

  it('starts a shell at the fitted size, in your home folder without a chat, when none runs', async () => {
    const { terminals, calls } = withTerminals([]);
    await new Promise((resolve) => setTimeout(resolve));
    terminals.size.set({ cols: 120, rows: 30 });
    await terminals.load();
    expect(calls.find((c) => c.command === 'terminal.open')!.request).toEqual({
      cwd: 'C:/Users/me',
      cols: 120,
      rows: 30,
    });
    expect(terminals.shown()?.id).toBe('new-1');
  });

  it('says why when the shells can’t be reached', async () => {
    const { terminals, answers } = withTerminals([]);
    answers['terminal.list'] = () => Promise.reject(new Error('The service is gone'));
    await terminals.load();
    expect(terminals.read()).toBe(false);
    expect(terminals.failed()).toBe('The service is gone');
  });

  it('shows the tab after a closed one, or the one before when it was the last', async () => {
    const { terminals, calls } = withTerminals([shell('a'), shell('b'), shell('c')]);
    await terminals.load();
    terminals.show('b');
    await terminals.close('b');
    expect(terminals.terminals().map(({ id }) => id)).toEqual(['a', 'c']);
    expect(terminals.shown()?.id).toBe('c');
    expect(calls.filter((c) => c.command === 'terminal.close').map((c) => c.request)).toEqual([
      { id: 'b' },
    ]);
    await terminals.close('c');
    expect(terminals.shown()?.id).toBe('a');
  });

  it('drops the tab of a shell that exits', async () => {
    const { terminals, emit } = withTerminals([shell('a'), shell('b')]);
    await terminals.load();
    emit('terminal.exited', { id: 'b', exitCode: 0 });
    expect(terminals.terminals().map(({ id }) => id)).toEqual(['a']);
    expect(terminals.shown()?.id).toBe('a');
  });
});
