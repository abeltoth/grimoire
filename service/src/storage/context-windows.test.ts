import { describe, expect, it } from 'vitest';
import { ContextWindows } from './context-windows';
import { openDatabase } from './database';

describe('ContextWindows', () => {
  it("keeps each model's last window, with where it compacts when it does", () => {
    const windows = new ContextWindows(openDatabase(':memory:'));
    windows.put('claude-code', 'claude-opus-5-5', { limit: 200_000, compactsAt: 167_000 });
    windows.put('claude-code', 'claude-sonnet-5-5', {
      limit: 200_000,
      fixed: 'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
    });
    windows.put('claude-code', 'claude-opus-5-5', { limit: 400_000, compactsAt: 367_000 });
    expect(windows.get('claude-code', 'claude-opus-5-5')).toEqual({
      limit: 400_000,
      compactsAt: 367_000,
    });
    expect(windows.get('claude-code', 'claude-sonnet-5-5')).toEqual({
      limit: 200_000,
      fixed: 'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
    });
    expect(windows.get('fake', 'claude-opus-5-5')).toBeUndefined();
  });
});
