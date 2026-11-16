import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { fakeBridge, render } from '../../../testing/app-testing';
import { Focus } from '../focus';
import { ShellRegistry } from '../shell-registry';

@Component({ selector: 'gr-test-ledger', template: '<p class="ledger">The ledger</p>' })
class Ledger {}

describe('alone-page', () => {
  it('lays a right page alone in the chat’s place in focus mode, and the chat again at Back', async () => {
    const { bridge, calls } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    TestBed.inject(ShellRegistry).rightPages.add({
      id: 'ledger',
      label: 'Ledger',
      component: Ledger,
    });
    const focus = TestBed.inject(Focus);
    focus.enter();
    focus.lay('ledger');
    await fixture.whenStable();
    expect(el.classList).toContain('single');
    expect(texts('gr-alone-page .title')).toEqual(['Ledger']);
    expect(texts('gr-alone-page .ledger')).toEqual(['The ledger']);
    expect(el.querySelector('gr-page[side="left"]')!.getAttribute('aria-label')).toBe('Ledger');
    expect(calls).toContainEqual({ command: 'layout.set', request: { focusPage: 'ledger' } });

    el.querySelector<HTMLButtonElement>('gr-alone-page .gr-link')!.click();
    await fixture.whenStable();
    expect(el.querySelector('gr-alone-page')).toBeNull();
    expect(calls).toContainEqual({ command: 'layout.set', request: { focusPage: null } });
  });

  it('isn’t shown out of focus mode, and going in lays the chat', async () => {
    const { bridge } = fakeBridge();
    const { fixture, el } = await render(bridge);
    TestBed.inject(ShellRegistry).rightPages.add({
      id: 'ledger',
      label: 'Ledger',
      component: Ledger,
    });
    const focus = TestBed.inject(Focus);
    focus.lay('ledger');
    await fixture.whenStable();
    expect(el.querySelector('gr-alone-page')).toBeNull();
    focus.enter();
    await fixture.whenStable();
    expect(el.querySelector('gr-alone-page')).toBeNull();
  });
});
