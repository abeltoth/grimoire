import { Pipe, type PipeTransform, inject } from '@angular/core';
import type { GrimoireBridge } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '../core/bridge';

export type Platform = GrimoireBridge['platform'];

/** A shortcut such as 'Mod+K'. Mod is ⌘ on a Mac and Ctrl elsewhere. */
export type Shortcut = string;

/**
 * How a shortcut is printed: as key caps ("Ctrl K"), in running text
 * ("Ctrl+N"), or for screen readers ("Control K"). On a Mac the first two
 * are both "⌘K".
 */
export type ShortcutStyle = 'keys' | 'text' | 'spoken';

const MAC: Record<string, string> = { Mod: '⌘', Shift: '⇧', Alt: '⌥' };
const MAC_SPOKEN: Record<string, string> = { Mod: 'Command', Alt: 'Option' };
const OTHER: Record<string, string> = { Mod: 'Ctrl' };
const OTHER_SPOKEN: Record<string, string> = { Mod: 'Control' };

export function formatShortcut(
  shortcut: Shortcut,
  platform: Platform,
  style: ShortcutStyle,
): string {
  const keys = shortcut.split('+');
  const mac = platform === 'mac';
  if (style === 'spoken') {
    const names = mac ? MAC_SPOKEN : OTHER_SPOKEN;
    return keys.map((key) => names[key] ?? key).join(' ');
  }
  if (mac) return keys.map((key) => MAC[key] ?? key).join('');
  return keys.map((key) => OTHER[key] ?? key).join(style === 'keys' ? ' ' : '+');
}

/** Whether a key press is the shortcut, with exactly its modifier keys. */
export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: Shortcut,
  platform: Platform,
): boolean {
  const keys = shortcut.split('+');
  const modifiers = new Set(keys.slice(0, -1));
  const mac = platform === 'mac';
  return (
    event.key.toLowerCase() === keys.at(-1)!.toLowerCase() &&
    (mac ? event.metaKey : event.ctrlKey) === modifiers.has('Mod') &&
    !(mac ? event.ctrlKey : event.metaKey) &&
    event.shiftKey === modifiers.has('Shift') &&
    event.altKey === modifiers.has('Alt')
  );
}

/** `{{ 'Mod+K' | shortcut: 'keys' }}`, for the platform the app runs on. */
@Pipe({ name: 'shortcut' })
export class ShortcutPipe implements PipeTransform {
  private readonly platform = inject(GRIMOIRE_BRIDGE).platform;

  transform(shortcut: Shortcut | undefined, style: ShortcutStyle = 'text'): string {
    return shortcut ? formatShortcut(shortcut, this.platform, style) : '';
  }
}
