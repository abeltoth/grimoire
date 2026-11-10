import type { Memory } from '@grimoire/contract';
import { columns, curve, kindOf, missing, related, resolve } from './memory-map';

const memory = (name: string, type: string, links: string[] = []): Memory => ({
  name,
  path: `/memory/${name.replace(/ /g, '-')}.md`,
  type,
  changedAt: 0,
  links,
  indexed: true,
});

describe('the memory map', () => {
  const tokens = memory('Design tokens', 'project', ['angular-conventions', 'Gone']);
  const angular = memory('Angular conventions', 'reference', ['design tokens']);
  const commits = memory('Commit style', 'feedback');
  const odd = memory('Odd one', 'idea');
  const untyped = memory('Untyped', '');
  const all = [untyped, odd, angular, commits, tokens];

  it('finds a linked memory by its name or its file, whatever the case', () => {
    expect(resolve(all, 'DESIGN TOKENS')).toBe(tokens);
    expect(resolve(all, 'angular-conventions')).toBe(angular);
    expect(resolve(all, 'Gone')).toBeUndefined();
    expect(missing(all, tokens)).toEqual(['Gone']);
  });

  it('says what a memory links to, the links that name none, and what links to it', () => {
    expect(related(all, tokens.path)).toEqual({
      to: [angular],
      missing: ['Gone'],
      from: [angular],
    });
    expect(related(all, '/elsewhere.md')).toEqual({ to: [], missing: [], from: [] });
  });

  it('stands the kinds in their order, any other after them, then those that say none', () => {
    expect(columns(all).map((column) => column.title)).toEqual([
      'Feedback',
      'Projects',
      'References',
      'Idea',
      'Other',
    ]);
    expect(kindOf('user')).toBe('About you');
  });

  it('draws a link across the gap between columns, or out and back along a shared one', () => {
    const box = (left: number, top: number) => new DOMRect(left, top, 100, 20);
    const origin = box(0, 0);
    expect(curve(box(0, 0), box(200, 40), origin)).toEqual({
      d: 'M 100 10 C 150 10, 150 50, 200 50',
      x: 200,
      y: 50,
    });
    expect(curve(box(0, 0), box(0, 60), origin)).toEqual({
      d: 'M 100 10 C 132 10, 132 70, 100 70',
      x: 100,
      y: 70,
    });
  });
});
