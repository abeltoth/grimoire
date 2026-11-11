import { TestBed } from '@angular/core/testing';
import { Output } from './output';

describe('Output', () => {
  async function output(text: string, command = '') {
    const fixture = TestBed.createComponent(Output);
    fixture.componentRef.setInput('title', 'Runs the tests');
    fixture.componentRef.setInput('text', text);
    fixture.componentRef.setInput('command', command);
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
    expect(el.querySelector('.command')).toBeNull();
  });

  it('sets the command in full above its output, a $ before its first line', async () => {
    const { texts } = await output('ok', 'npm test \\\n  --watch=false');
    expect(texts('.command .code')).toEqual(['npm test \\', '--watch=false']);
    expect(texts('.command .number')).toEqual(['$', '']);
  });
});
