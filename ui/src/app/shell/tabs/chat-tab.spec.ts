import { TestBed } from '@angular/core/testing';
import { ChatTab, type ChatTabTone } from './chat-tab';

async function tab(tone: ChatTabTone, unavailable = false) {
  const fixture = TestBed.createComponent(ChatTab);
  fixture.componentRef.setInput('side', 'left');
  fixture.componentRef.setInput('tone', tone);
  fixture.componentRef.setInput('heading', 'Fix the ribbon');
  fixture.componentRef.setInput('meta', 'Thinking');
  fixture.componentRef.setInput('current', true);
  fixture.componentRef.setInput('unavailable', unavailable);
  await fixture.whenStable();
  const said: string[] = [];
  fixture.componentInstance.picked.subscribe(() => said.push('picked'));
  fixture.componentInstance.dismissed.subscribe(() => said.push('dismissed'));
  fixture.componentInstance.settings.subscribe(() => said.push('settings'));
  const el = fixture.nativeElement as HTMLElement;
  const button = el.querySelector<HTMLButtonElement>('button')!;
  return { el, button, said };
}

describe('ChatTab', () => {
  it('wears its tone, and a sheen while it marks the open chat at rest', async () => {
    const { el } = await tab('open');
    expect(el.dataset['tone']).toBe('open');
    expect(el.classList).toContain('current');
    expect(el.classList).toContain('sheen');
  });

  it('is picked by a click, closed by a middle-click, and opens its settings on a right-click', async () => {
    const { button, said } = await tab('idle');
    button.click();
    button.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }));
    button.dispatchEvent(new MouseEvent('auxclick', { button: 2, bubbles: true }));
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    button.dispatchEvent(menu);
    expect(said).toEqual(['picked', 'dismissed', 'settings']);
    expect(menu.defaultPrevented).toBe(true);
  });

  it('does nothing yet while it is unavailable', async () => {
    const { button, said } = await tab('new', true);
    button.click();
    button.dispatchEvent(new MouseEvent('auxclick', { button: 1, bubbles: true }));
    button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(said).toEqual([]);
  });
});
