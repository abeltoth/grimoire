import { TestBed } from '@angular/core/testing';
import { type Slice, UsagePie, shareText, slicesOf } from './pie-chart';

const texts = (el: HTMLElement, selector: string) =>
  [...el.querySelectorAll(selector)].map((node) => node.textContent!.replace(/\s+/g, ' ').trim());

/** Each legend row as its name and share. */
const legend = (el: HTMLElement) =>
  [...el.querySelectorAll('.legend li')].map(
    (row) =>
      `${row.querySelector('.name')!.textContent!.trim()} ${row.querySelector('b')!.textContent}`,
  );

describe('slicesOf', () => {
  it('keeps the six heaviest, a colour each, and puts the rest together as Other', () => {
    const slices = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ name: `s${n}`, value: n }));
    const drawn = slicesOf(slices);
    expect(drawn.map((slice) => slice.name)).toEqual(['s8', 's7', 's6', 's5', 's4', 's3', 'Other']);
    expect(drawn.map((slice) => slice.color)).toEqual([
      'var(--gr-chart-1)',
      'var(--gr-chart-2)',
      'var(--gr-chart-3)',
      'var(--gr-chart-4)',
      'var(--gr-chart-5)',
      'var(--gr-chart-6)',
      'var(--gr-ink-faint)',
    ]);
    expect(drawn.at(-1)!.value).toBe(3);
    expect(drawn.reduce((all, slice) => all + slice.share, 0)).toBeCloseTo(100);
  });

  it('counts what a list left out into Other, and nothing for an empty pie', () => {
    expect(
      slicesOf([
        { name: 'a', value: 3 },
        { name: 'left out', value: 1, rest: true },
      ]).map(({ name, share }) => [name, share]),
    ).toEqual([
      ['a', 75],
      ['Other', 25],
    ]);
    expect(slicesOf([{ name: 'a', value: 0 }])).toEqual([]);
  });

  it('writes a sliver as under one percent', () => {
    expect(shareText(0.4)).toBe('<1%');
    expect(shareText(33.4)).toBe('33%');
  });
});

describe('UsagePie', () => {
  async function pie(slices: Slice[]) {
    const fixture = TestBed.createComponent(UsagePie);
    fixture.componentRef.setInput('caption', 'By model');
    fixture.componentRef.setInput('slices', slices);
    fixture.componentRef.setInput('format', (n: number) => `${n} tokens`);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('draws a slice for each, with its share in the legend and in a tooltip on focus', async () => {
    const { fixture, el } = await pie([
      { name: 'Haiku', value: 1 },
      { name: 'Opus', value: 3 },
    ]);
    expect(texts(el, 'figcaption')).toEqual(['By model']);
    expect(legend(el)).toEqual(['Opus 75%', 'Haiku 25%']);
    const slices = el.querySelectorAll<SVGPathElement>('path.slice');
    expect([...slices].map((slice) => slice.getAttribute('aria-label'))).toEqual([
      'Opus: 3 tokens, 75%',
      'Haiku: 1 tokens, 25%',
    ]);

    slices[1]!.dispatchEvent(new FocusEvent('focus'));
    await fixture.whenStable();
    expect(texts(el, '.tip-head, .tip strong, .tip-name')).toEqual(['Haiku', '1 tokens', '25%']);
    expect(slices[0]!.classList).toContain('dim');
    slices[1]!.dispatchEvent(new FocusEvent('blur'));
    await fixture.whenStable();
    expect(el.querySelector('.tip')).toBeNull();
  });

  it('draws one slice as the whole disc', async () => {
    const { el } = await pie([{ name: 'Opus', value: 5 }]);
    expect(el.querySelector('path.slice')!.getAttribute('d')).toContain('A58,58 0 1 1 60,118');
  });

  it('opens a slice with a key from the pie or the legend, and not Other', async () => {
    const { fixture, el } = await pie([
      { name: 'Ribbon', value: 3, key: 'chat-1' },
      { name: 'more', value: 1, rest: true },
    ]);
    const picked: string[] = [];
    fixture.componentInstance.picked.subscribe((key) => picked.push(key));
    const slices = el.querySelectorAll<SVGPathElement>('path.slice');
    slices[0]!.dispatchEvent(new MouseEvent('click'));
    slices[1]!.dispatchEvent(new MouseEvent('click'));
    el.querySelector<HTMLButtonElement>('.legend button')!.click();
    expect(picked).toEqual(['chat-1', 'chat-1']);
    expect(texts(el, '.legend button')).toEqual(['Ribbon']);
  });
});
