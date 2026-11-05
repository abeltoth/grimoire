import { Injectable, computed, inject } from '@angular/core';
import { Settings } from './settings';

/**
 * How Grimoire says things: in the book's own words, such as Colophon,
 * chapter and seal, or plainly: Settings, chat, approve. The Colophon
 * switches between them.
 */
@Injectable({ providedIn: 'root' })
export class Wording {
  private readonly settings = inject(Settings);

  readonly plain = computed(() => this.settings.all().wording === 'plain');

  /** The book's words, or the plain ones when Grimoire speaks plainly. */
  readonly say = (book: string, plain: string): string => (this.plain() ? plain : book);

  /** A shell entry's label, or its plain one when it has one and Grimoire speaks plainly. */
  readonly label = (entry: { label: string; plainLabel?: string }): string =>
    this.plain() && entry.plainLabel ? entry.plainLabel : entry.label;

  /** What a chapter is called until it has a title. */
  readonly untitled = computed(() => this.say('Untitled chapter', 'Untitled chat'));

  /** The link that turns back to a page: "Back to the Outline", or plainly "Back to Plan". */
  readonly back = (to: string): string => this.say(`Back to the ${to}`, `Back to ${to}`);
}
