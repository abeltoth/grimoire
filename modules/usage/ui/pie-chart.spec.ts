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
  it('keeps the ten largest, a colour each, and puts the rest together as Other', () => {
    const slices = Array.from({ length: 12 }, (_, i) => ({ name: `s${i + 1}`, value: i + 1 }));
    const drawn = slicesOf(slices);
    expect(drawn.map((slice) => slice.name)).toEqual([
      's12',
      's11',
      's10',
      's9',
      's8',
      's7',
      's6',
      's5',
      's4',
      's3',
      'Other',
    ]);
    expect(drawn.map((slice) => slice.color)).toEqual([
      ...Array.from({ length: 10 }, (_, i) => `var(--gr-chart-${i + 1})`),
      'var(--gr-ink-faint)',
    ]);
    expect(drawn.at(-1)!.value).toBe(3);
    expect(drawn.reduce((all, slice) => all + slice.share, 0)).toBeCloseTo(100);
  });

  it('names Other with how many it holds, those a list left out included', () => {
    const slices: Slice[] = [
      ...Array.from({ length: 11 }, (_, i) => ({ name: `c${i}`, value: 10 })),
      { name: 'left out', value: 5, rest: true, count: 40 },
    ];
    expect(slicesOf(slices, 'chats').at(-1)!.name).toBe('Other · 41 chats');
    expect(slicesOf(slices).at(-1)!.name).toBe('Other');
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
    fixture.componentRef.setInput('label', 'Cost by model');
    fixture.componentRef.setInput('slices', slices);
    fixture.componentRef.setInput('format', (n: number) => `$${n}`);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('draws a slice for each with its share in the legend, and reads the one in focus out in the middle', async () => {
    const { fixture, el } = await pie([
      { name: 'Haiku', value: 1 },
      { name: 'Opus', value: 3 },
    ]);
    expect(el.querySelector('svg')!.getAttribute('aria-label')).toBe('Cost by model');
    expect(legend(el)).toEqual(['Opus 75%', 'Haiku 25%']);
    const slices = el.querySelectorAll<SVGPathElement>('path.slice');
    expect([...slices].map((slice) => slice.getAttribute('aria-label'))).toEqual([
      'Opus: $3, 75%',
      'Haiku: $1, 25%',
    ]);
    // The whole, until a slice is under the pointer or in focus.
    expect(texts(el, '.hole > *')).toEqual(['$4', 'in all']);

    slices[1]!.dispatchEvent(new FocusEvent('focus'));
    await fixture.whenStable();
    expect(texts(el, '.hole > *')).toEqual(['Haiku', '$1', '25%']);
    expect(slices[0]!.classList).toContain('dim');
    slices[1]!.dispatchEvent(new FocusEvent('blur'));
    await fixture.whenStable();
    expect(texts(el, '.hole > *')).toEqual(['$4', 'in all']);
  });

  it('draws one slice as the whole ring', async () => {
    const { el } = await pie([{ name: 'Opus', value: 5 }]);
    const d = el.querySelector('path.slice')!.getAttribute('d')!;
    expect(d).toContain('A58,58 0 1 1 60,118');
    expect(d).toContain('A36,36 0 1 1 60,96');
  });

  it('opens a slice with a key from the ring or the legend, and not Other', async () => {
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
    expect(el.querySelector('.legend button')!.classList).not.toContain('gr-link');
  });
});
