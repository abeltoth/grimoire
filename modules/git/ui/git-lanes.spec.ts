import { TestBed } from '@angular/core/testing';
import type { GraphRow } from './graph-layout';
import { GitLanes } from './git-lanes';

async function lanes(row: GraphRow, open = false) {
  const fixture = TestBed.createComponent(GitLanes);
  fixture.componentRef.setInput('row', row);
  fixture.componentRef.setInput('open', open);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('GitLanes', () => {
  it('draws straight lines through a lane, curves between lanes, and the dot in its lane', async () => {
    const el = await lanes({
      lane: 1,
      colour: 3,
      width: 2,
      top: [{ from: 1, to: 1, colour: 3 }],
      bottom: [
        { from: 1, to: 1, colour: 3 },
        { from: 1, to: 0, colour: 5 },
      ],
    });
    expect(el.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 2 2');
    expect([...el.querySelectorAll('path')].map((p) => p.getAttribute('d'))).toEqual([
      'M 1.5 0 V 1',
      'M 1.5 1 V 2',
      'M 1.5 1 C 1.5 1.5, 0.5 1.5, 0.5 2',
    ]);
    expect([...el.querySelectorAll('path')].map((p) => p.classList.contains('lane-5'))).toEqual([
      false,
      false,
      true,
    ]);
    const dot = el.querySelector('circle')!;
    expect(dot.getAttribute('cx')).toBe('1.5');
    expect(dot.classList).toContain('lane-3');
    expect(dot.classList).not.toContain('hollow');
    expect(el.style.getPropertyValue('--lanes')).toBe('2');
  });

  it('draws the changes not committed yet hollow, on a dashed line', async () => {
    const el = await lanes(
      { lane: 0, colour: 0, width: 1, top: [], bottom: [{ from: 0, to: 0, colour: 0 }] },
      true,
    );
    expect(el.querySelector('circle')!.classList).toContain('hollow');
    expect(el.querySelector('path')!.classList).toContain('hollow');
  });
});
