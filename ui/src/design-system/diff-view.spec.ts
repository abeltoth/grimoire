import { TestBed } from '@angular/core/testing';
import { DiffView, type NumberedLine } from './diff-view';

async function diff(lines: NumberedLine[], breaks: number[] = []) {
  const fixture = TestBed.createComponent(DiffView);
  fixture.componentRef.setInput('file', 'src/a.ts');
  fixture.componentRef.setInput('lines', lines);
  fixture.componentRef.setInput('breaks', breaks);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const texts = (selector: string) =>
    [...el.querySelectorAll(selector)].map((node) => node.textContent!.trim());
  return { fixture, el, texts };
}

describe('DiffView', () => {
  it('strikes and signs removed lines, and signs inserted ones', async () => {
    const { el, texts } = await diff([
      { kind: 'same', text: 'import { a } from "./a";' },
      { kind: 'removed', text: 'const a = 1;' },
      { kind: 'inserted', text: 'const b = 1;' },
      { kind: 'inserted', text: 'const c = 2;' },
    ]);
    expect(el.getAttribute('aria-label')).toBe('Corrections to src/a.ts');
    expect(texts('.head .detail')).toEqual(['+2 −1']);
    expect(texts('.line .number')).toEqual(['', '−', '+', '+']);
    expect(el.querySelectorAll('.line.removed')).toHaveLength(1);
    expect(el.querySelectorAll('.line.inserted')).toHaveLength(2);
  });

  it('sets each stacked edit apart', async () => {
    const { el } = await diff(
      [
        { kind: 'inserted', text: 'one' },
        { kind: 'inserted', text: 'two' },
        { kind: 'inserted', text: 'three' },
      ],
      [1],
    );
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

  it('numbers its lines when they come numbered, and dims the ones around the change', async () => {
    const { el, texts } = await diff([
      { kind: 'same', text: 'a', at: 9 },
      { kind: 'removed', text: 'b', at: 10 },
      { kind: 'inserted', text: 'c', at: 10 },
    ]);
    expect(texts('.line .at')).toEqual(['9', '10', '10']);
    expect(el.querySelectorAll('.line.numbered')).toHaveLength(3);
    expect(el.querySelectorAll('.line.same')).toHaveLength(1);
  });

  it('leaves the number column out when the lines come unnumbered', async () => {
    const { el } = await diff([{ kind: 'inserted', text: 'a' }]);
    expect(el.querySelector('.at, .numbered')).toBeNull();
  });

  it('offers to be put away only when asked to', async () => {
    const { fixture, el } = await diff([{ kind: 'same', text: 'a' }]);
    expect(el.querySelector('button')).toBeNull();
    fixture.componentRef.setInput('closable', true);
    await fixture.whenStable();
    let closed = 0;
    fixture.componentInstance.hide.subscribe(() => closed++);
    el.querySelector<HTMLButtonElement>('button')!.click();
    expect(closed).toBe(1);
  });
});
