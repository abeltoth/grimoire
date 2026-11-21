import type { Platform } from './bridge';

/** A key press, as a window's keyboard event and the app's input event both tell it. */
export interface KeyPress {
  /** The key's value, such as "k", "K" or "ArrowLeft". */
  key: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

/**
 * Whether a key press is the shortcut, such as 'Mod+K', with exactly its
 * modifier keys. Mod is ⌘ on a Mac and Ctrl elsewhere.
 */
export function matchesKeys(press: KeyPress, shortcut: string, platform: Platform): boolean {
  const keys = shortcut.split('+');
  const modifiers = new Set(keys.slice(0, -1));
  const mac = platform === 'mac';
  return (
    press.key.toLowerCase() === keys.at(-1)!.toLowerCase() &&
    (mac ? press.meta : press.ctrl) === modifiers.has('Mod') &&
    !(mac ? press.ctrl : press.meta) &&
    press.shift === modifiers.has('Shift') &&
    press.alt === modifiers.has('Alt')
  );
}
