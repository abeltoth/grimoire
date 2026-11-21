import {
  type BrowserAction,
  type BrowserMove,
  type KeyPress,
  type Platform,
  matchesKeys,
} from '@grimoire/contract';

/** What a key pressed inside a web page does: the browser's own keys first, then Grimoire's shortcuts. */
export type KeyEffect =
  | { kind: 'move'; move: BrowserMove }
  | { kind: 'zoom'; by: -1 | 0 | 1 }
  | { kind: 'action'; action: BrowserAction }
  | { kind: 'grimoire' };

/** The browser's own keys, as a browser has them, ahead of Grimoire's shortcuts of the same keys. */
const BROWSER_KEYS: readonly [string, KeyEffect][] = [
  ['Mod+T', { kind: 'action', action: 'new-tab' }],
  ['Mod+W', { kind: 'action', action: 'close-tab' }],
  ['Mod+L', { kind: 'action', action: 'focus-address' }],
  ['Mod+R', { kind: 'move', move: 'reload' }],
  ['F5', { kind: 'move', move: 'reload' }],
  ['Alt+ArrowLeft', { kind: 'move', move: 'back' }],
  ['Alt+ArrowRight', { kind: 'move', move: 'forward' }],
  ['Mod+[', { kind: 'move', move: 'back' }],
  ['Mod+]', { kind: 'move', move: 'forward' }],
  ['Mod+=', { kind: 'zoom', by: 1 }],
  ['Mod+-', { kind: 'zoom', by: -1 }],
  ['Mod+0', { kind: 'zoom', by: 0 }],
];

/** What the key does, given Grimoire's shortcuts; null when it's the page's. */
export function keyEffect(
  press: KeyPress,
  shortcuts: readonly string[],
  platform: Platform,
): KeyEffect | null {
  const own = BROWSER_KEYS.find(([shortcut]) => matchesKeys(press, shortcut, platform));
  if (own) return own[1];
  // A shortcut can't name "+", which is Shift and = on many keyboards, or the number pad's.
  if (press.key === '+' && (platform === 'mac' ? press.meta : press.ctrl) && !press.alt)
    return { kind: 'zoom', by: 1 };
  return shortcuts.some((shortcut) => matchesKeys(press, shortcut, platform))
    ? { kind: 'grimoire' }
    : null;
}
