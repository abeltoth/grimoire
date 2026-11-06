import { InjectionToken } from '@angular/core';
import type { ChatId } from '@grimoire/contract';

/**
 * The chapter this window holds as a loose leaf, popped out of the book;
 * null in the book's own window. The app opens a leaf's window with
 * `?leaf=<chat ID>`.
 */
export const LEAF = new InjectionToken<ChatId | null>('Leaf', {
  providedIn: 'root',
  factory: () => new URLSearchParams(location.search).get('leaf'),
});
