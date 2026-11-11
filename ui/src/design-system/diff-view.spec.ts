import { TestBed } from '@angular/core/testing';
import type { DiffLine } from '@grimoire/contract';
import { DiffView } from './diff-view';

async function diff(lines: DiffLine[], breaks: number[] = []) {
  const fixture = TestBed.createComponent(DiffView);
  fixture.componentRef.setInput('file', 'src/a.ts');
  fixture.componentRef.setInput('lines', lines);
  fixture.componentRef.setInput('breaks', breaks);
  fixture.componentRef.setInput('caption', 'as marked by Claude Code');
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const texts = (selector: string) =>
    [...el.querySelectorAll(selector)].map((node) => node.textContent!.trim());
  return { fixture, el, texts };
}

describe('DiffView', () => {
  it('strikes removed lines and marks a run of inserted ones once', async () => {
    const { el, texts } = await diff([
      { kind: 'same', text: 'import { a } from "./a";' },
      { kind: 'removed', text: 'const a = 1;' },
      { kind: 'inserted', text: 'const b = 1;' },
      { kind: 'inserted', text: 'const c = 2;' },
    ]);
    expect(el.getAttribute('aria-label')).toBe('Corrections to src/a.ts');
    expect(texts('.head .detail')).toEqual(['corrections, as marked by Claude Code', '+2 −1']);
    expect(texts('.line .mark')).toEqual(['', 'dele', '‸ insert 2 lines', '']);
    expect(el.querySelectorAll('.line.removed')).toHaveLength(1);
    expect(el.querySelectorAll('.line.inserted')).toHaveLength(2);
  });

  it('marks each stacked edit’s insertion apart', async () => {
    const { el, texts } = await diff(
      [
        { kind: 'inserted', text: 'one' },
        { kind: 'inserted', text: 'two' },
        { kind: 'inserted', text: 'three' },
      ],
      [1],
    );
    expect(texts('.line .mark')).toEqual(['‸ insert', '‸ insert 2 lines', '']);
    expect(el.querySelectorAll('.line.break')).toHaveLength(1);
  });

  it('offers to open the file in Files only when asked to', async () => {
    const { fixture, el } = await diff([{ kind: 'same', text: 'a' }]);
    expect(el.querySelector('button')).toBeNull();
    fixture.componentRef.setInput('openable', true);
    await fixture.whenStable();
    let opened = 0;
    fixture.componentInstance.open.subscribe(() => opened++);
    el.querySelector<HTMLButtonElement>('button')!.click();
    expect(opened).toBe(1);
  });
});
