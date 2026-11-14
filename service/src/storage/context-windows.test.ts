import { describe, expect, it } from 'vitest';
import { ContextWindows } from './context-windows';
import { openDatabase } from './database';

describe('ContextWindows', () => {
  it("keeps each chat's last window, with where it compacts when it does", () => {
    const windows = new ContextWindows(openDatabase(':memory:'));
    windows.put('a', { limit: 200_000, compactsAt: 167_000 });
    windows.put('b', { limit: 200_000 });
    windows.put('a', { limit: 1_000_000, compactsAt: 967_000 });
    expect(windows.get('a')).toEqual({ limit: 1_000_000, compactsAt: 967_000 });
    expect(windows.get('b')).toEqual({ limit: 200_000 });
    expect(windows.get('c')).toBeUndefined();
  });
});
