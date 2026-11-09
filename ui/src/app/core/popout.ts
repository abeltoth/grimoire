import { InjectionToken } from '@angular/core';
import type { ChatId } from '@grimoire/contract';

/**
 * The chat this window holds as a popout, popped out of the book;
 * null in the book's own window. The app opens a popout's window with
 * `?popout=<chat ID>`.
 */
export const POPOUT = new InjectionToken<ChatId | null>('Popout', {
  providedIn: 'root',
  factory: () => new URLSearchParams(location.search).get('popout'),
});
