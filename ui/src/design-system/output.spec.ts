import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Output } from './output';

describe('Output', () => {
  async function output(text: string, running = false) {
    const fixture = TestBed.createComponent(Output);
    fixture.componentRef.setInput('title', 'Runs the tests');
    fixture.componentRef.setInput('text', text);
    fixture.componentRef.setInput('running', running);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const texts = (selector: string) =>
      [...el.querySelectorAll(selector)].map((node) => node.textContent!.trim());
    return { el, texts };
  }

  it('shows what printed, a line each, without terminal colours or the last line break', async () => {
    const { el, texts } = await output('\u001b[32m12 passed\u001b[0m\r\n1 failed\n');
    expect(el.getAttribute('aria-label')).toBe('Output of Runs the tests');
    expect(texts('.body .code')).toEqual(['12 passed', '1 failed']);
  });

  it('while the tool runs, shows what it was asked and that its output is to come', async () => {
    const { texts } = await output('query: signals', true);
    expect(texts('.head .detail')).toEqual(['what it was asked']);
    expect(texts('.body .code')).toEqual(['query: signals', 'running…']);
    expect((await output('', true)).texts('.body .code')).toEqual(['running…']);
  });

  it('sets the command it is given above its output, and anything else in its body', async () => {
    @Component({
      imports: [Output],
      template: `<gr-output title="Runs the tests" text="ok">
        <p class="command">npm test</p>
        <p class="asked">asked</p>
      </gr-output>`,
    })
    class Host {}
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const order = [...el.querySelectorAll('gr-output > *')].map((node) => node.className);
    expect(order).toEqual(['head', 'command', 'body']);
    expect(el.querySelector('.body .asked')).not.toBeNull();
  });
});
