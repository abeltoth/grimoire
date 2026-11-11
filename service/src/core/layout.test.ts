import { describe, expect, it } from 'vitest';
import { openDatabase } from '../storage/database';
import { LayoutStore } from './layout';

describe('LayoutStore', () => {
  it('remembers the layout, and only what it knows', () => {
    const layout = new LayoutStore(openDatabase(':memory:'));
    expect(layout.get()).toEqual({
      current: null,
      beside: null,
      lastUsed: null,
      focus: false,
      popouts: [],
    });
    const lastUsed = { agent: 'claude-code', settings: { cwd: '/work', mode: 'plan' as const } };
    layout.set({ current: 'a', beside: 'b', lastUsed });
    layout.set({ unknown: 1 } as never);
    expect(layout.get()).toEqual({
      current: 'a',
      beside: 'b',
      lastUsed,
      focus: false,
      popouts: [],
    });
    const popouts = [{ chatId: 'c', bounds: { x: 10, y: 20, width: 800, height: 900 } }];
    layout.set({ current: null, beside: null, focus: true, popouts });
    expect(layout.get()).toEqual({ current: null, beside: null, lastUsed, focus: true, popouts });
  });
});
