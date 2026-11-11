import { TestBed } from '@angular/core/testing';
import { useFakeBridge } from '@ui/testing/app-testing';
import { TerminalSheet } from './terminal-sheet';
import { useTestScreen } from './xterm-testing';

describe('TerminalSheet', () => {
  useTestScreen();

  async function sheet(shown: boolean) {
    const fake = useFakeBridge();
    fake.answers['terminal.screen'] = () => ({ cols: 80, rows: 24, seq: 2, data: 'kept' });
    const fixture = TestBed.createComponent(TerminalSheet);
    fixture.componentRef.setInput('terminal', {
      id: 'a',
      cwd: 'C:/Users/me',
      shell: 'pwsh',
      openedAt: 0,
    });
    fixture.componentRef.setInput('shown', shown);
    await fixture.whenStable();
    return { ...fake, fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('loads nothing until it is first shown', async () => {
    const { fixture, el, calls } = await sheet(false);
    expect(calls.some((c) => c.command === 'terminal.screen')).toBe(false);
    expect(el.classList.contains('shown')).toBe(false);

    fixture.componentRef.setInput('shown', true);
    await fixture.whenStable();
    expect(el.classList.contains('shown')).toBe(true);
    await vi.waitFor(() => expect(el.querySelector('.xterm')).not.toBeNull());
    expect(calls.filter((c) => c.command === 'terminal.screen').map((c) => c.request)).toEqual([
      { id: 'a' },
    ]);
  });
});
