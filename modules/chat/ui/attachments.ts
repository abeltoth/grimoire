import { Component, booleanAttribute, computed, inject, input, output } from '@angular/core';
import type { Attachment } from '@grimoire/contract';
import { Icon } from '@ui/design-system/icon';
import { AgentCatalog } from '@ui/app/core/agent-catalog';

type Shown =
  | { kind: 'plate'; attachment: Attachment; number: string; src: string; caption: string }
  | { kind: 'ref'; attachment: Attachment; number: number; name: string; file: string };

/**
 * What's sent with a message: pictures as numbered plates with captions, and
 * files as numbered references. On the next page each has a cross that
 * takes it off.
 */
@Component({
  selector: 'gr-attachments',
  imports: [Icon],
  templateUrl: './attachments.html',
  styleUrl: './attachments.css',
})
export class Attachments {
  private readonly catalog = inject(AgentCatalog);

  readonly attachments = input.required<readonly Attachment[]>();
  /** The chat's folder: files inside it are named from it. */
  readonly cwd = input<string>();
  readonly removable = input(false, { transform: booleanAttribute });
  readonly removed = output<Attachment>();

  protected readonly shown = computed(() => {
    let plates = 0;
    let refs = 0;
    return this.attachments().map((attachment): Shown => {
      if (attachment.kind === 'picture')
        return {
          kind: 'plate',
          attachment,
          number: roman(++plates),
          src: `data:${attachment.mediaType};base64,${attachment.data}`,
          caption: attachment.caption ?? 'Picture',
        };
      return {
        kind: 'ref',
        attachment,
        number: ++refs,
        name: relativeTo(this.cwd(), attachment.path) ?? this.catalog.folderName(attachment.path),
        file: attachment.path.split(/[\\/]/).at(-1) ?? attachment.path,
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
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
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
