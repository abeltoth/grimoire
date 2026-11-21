import { describe, expect, it } from 'vitest';
import { matchesKeys } from './shortcut';

const press = (
  key: string,
  held: Partial<{ ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }> = {},
) => ({
  key,
  ctrl: false,
  meta: false,
  shift: false,
  alt: false,
  ...held,
});

describe('matchesKeys', () => {
  it('takes Mod as Ctrl on Windows and ⌘ on a Mac', () => {
    expect(matchesKeys(press('k', { ctrl: true }), 'Mod+K', 'windows')).toBe(true);
    expect(matchesKeys(press('k', { meta: true }), 'Mod+K', 'windows')).toBe(false);
    expect(matchesKeys(press('k', { meta: true }), 'Mod+K', 'mac')).toBe(true);
    expect(matchesKeys(press('k', { ctrl: true }), 'Mod+K', 'mac')).toBe(false);
  });

  it('wants exactly the shortcut’s modifiers', () => {
    expect(matchesKeys(press('N', { ctrl: true, shift: true }), 'Mod+Shift+N', 'windows')).toBe(
      true,
    );
    expect(matchesKeys(press('n', { ctrl: true, shift: true }), 'Mod+N', 'windows')).toBe(false);
    expect(matchesKeys(press('k', { ctrl: true, alt: true }), 'Mod+K', 'windows')).toBe(false);
    expect(matchesKeys(press('k'), 'Mod+K', 'windows')).toBe(false);
  });
});
