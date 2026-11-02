import { Component, booleanAttribute, computed, inject, input, output } from '@angular/core';
import type { Enclosure } from '@grimoire/contract';
import { Icon } from '@ui/design-system/icon';
import { Chats } from '@ui/app/core/chats';

type Shown =
  | { kind: 'plate'; enclosure: Enclosure; number: string; src: string; caption: string }
  | { kind: 'ref'; enclosure: Enclosure; number: number; name: string; file: string };

/**
 * What's sent with an entry: pictures as numbered plates with captions, and
 * files as numbered references. On the next page each has a cross that
 * takes it off.
 */
@Component({
  selector: 'gr-enclosures',
  imports: [Icon],
  templateUrl: './enclosures.html',
  styleUrl: './enclosures.css',
})
export class Enclosures {
  private readonly chats = inject(Chats);

  readonly enclosures = input.required<readonly Enclosure[]>();
  /** The chapter's folder: files inside it are named from it. */
  readonly cwd = input<string>();
  readonly removable = input(false, { transform: booleanAttribute });
  readonly removed = output<Enclosure>();

  protected readonly shown = computed(() => {
    let plates = 0;
    let refs = 0;
    return this.enclosures().map((enclosure): Shown => {
      if (enclosure.kind === 'picture')
        return {
          kind: 'plate',
          enclosure,
          number: roman(++plates),
          src: `data:${enclosure.mediaType};base64,${enclosure.data}`,
          caption: enclosure.caption ?? 'Picture',
        };
      return {
        kind: 'ref',
        enclosure,
        number: ++refs,
        name: relativeTo(this.cwd(), enclosure.path) ?? this.chats.folderName(enclosure.path),
        file: enclosure.path.split(/[\\/]/).at(-1) ?? enclosure.path,
      };
    });
  });
}

/** A path inside the folder, from the folder, with forward slashes; undefined when it's outside. */
function relativeTo(cwd: string | undefined, file: string): string | undefined {
  if (!cwd) return undefined;
  const slashed = (path: string) => path.replaceAll('\\', '/').replace(/\/$/, '');
  const folder = slashed(cwd);
  const path = slashed(file);
  // Windows paths don't care about case.
  const caseless = /^[a-z]:/i.test(folder);
  const inside = caseless
    ? path.toLowerCase().startsWith(`${folder.toLowerCase()}/`)
    : path.startsWith(`${folder}/`);
  return inside ? path.slice(folder.length + 1) : undefined;
}

function roman(n: number): string {
  const numerals: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let rest = n;
  let written = '';
  for (const [value, numeral] of numerals) {
    while (rest >= value) {
      written += numeral;
      rest -= value;
    }
  }
  return written;
}
