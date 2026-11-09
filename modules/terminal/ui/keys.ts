import type { Platform } from '@grimoire/contract';

/**
 * Keys the window handles rather than the shell, on Windows and Linux:
 * Ctrl+V and Ctrl+Shift+V paste, Ctrl+Shift+C copies, and Ctrl+C copies
 * while text is selected (otherwise it interrupts, as in any terminal).
 * On a Mac, ⌘C and ⌘V never reach the shell, so nothing is kept from it.
 */
export function forWindow(
  event: KeyboardEvent,
  hasSelection: boolean,
  platform: Platform,
): boolean {
  if (platform === 'mac' || !event.ctrlKey || event.altKey || event.metaKey) return false;
  const key = event.key.toLowerCase();
  if (key === 'v') return true;
  return key === 'c' && (event.shiftKey || hasSelection);
}
